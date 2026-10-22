import {DEFAULTS, normalizeText, translate, libreURL} from './translation.js';
import {speechURL} from './audio-utils.js';
const cache = new Map();
const pending = new Map();
let active = 0;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['public-settings', 'translate'].includes(message?.type)) return;
  (async () => {
    const settings = {...DEFAULTS, ...(await chrome.storage.local.get('settings')).settings};
    if (message.type === 'public-settings') {
      const {enabled, bilingual, mode} = settings;
      return {ok: true, settings: {enabled, bilingual, mode}};
    }
    if (!settings.enabled) throw new Error('翻译已暂停');
    const text = normalizeText(message.text);
    if (!text) throw new Error('字幕为空');
    if (settings.provider === 'libre') {
      const origin = new URL(libreURL(settings.endpoint)).origin;
      if (!await chrome.permissions.contains({origins: [origin + '/*']})) throw new Error('请在插件设置中授权翻译服务地址');
    }
    const key = JSON.stringify([settings.provider, settings.endpoint, settings.source, settings.target, settings.apiKey, text]);
    if (cache.has(key)) return {ok: true, text: cache.get(key)};
    if (!pending.has(key)) {
      if (active >= 4) throw new Error('翻译繁忙，请稍后重试');
      active++;
      const job = translate(text, settings).then(result => {
        if (cache.size >= 500) cache.delete(cache.keys().next().value);
        cache.set(key, result);
        return result;
      }).finally(() => {active--; pending.delete(key);});
      pending.set(key, job);
    }
    return {ok: true, text: await pending.get(key)};
  })().then(respond).catch(error => respond({ok: false, error: error.name === 'TimeoutError' ? '翻译超时，请检查服务设置' : error.message === 'Failed to fetch' ? '无法连接翻译服务，请检查网络或服务地址' : error.message}));
  return true;
});
chrome.storage.onChanged.addListener((changes,area) => {
  if (area === 'local' && changes.settings) cache.clear();
});

let speechStarting = false;
async function offscreenExists() {
  return (await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('offscreen.html')]})).length > 0;
}
async function sendOffscreen(type, extra = {}) {
  if (!await offscreenExists()) return {ok:true,active:false};
  return chrome.runtime.sendMessage({target:'offscreen',type,...extra});
}
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (message?.type === 'speech-event' && sender.url === chrome.runtime.getURL('offscreen.html')) {
    chrome.tabs.sendMessage(message.tabId,{...message,type:'speech-display'},{frameId:0}).catch(() => {});
    chrome.storage.session.set({speechState:message});
    return;
  }
  if (!['speech-start','speech-stop','speech-status'].includes(message?.type) || sender.url !== chrome.runtime.getURL('popup.html')) return;
  (async () => {
    if (message.type === 'speech-status') {
      const result = await sendOffscreen('offscreen-status');
      return {...result,...(await chrome.storage.session.get('speechState'))};
    }
    if (message.type === 'speech-stop') return sendOffscreen('offscreen-stop');
    if (speechStarting) throw new Error('正在启动听译，请稍候');
    speechStarting = true;
    try {
      const settings = {...DEFAULTS,...(await chrome.storage.local.get('settings')).settings};
      if (!settings.enabled || settings.mode !== 'audio') throw new Error('请先开启翻译并保存「听声翻译」模式');
      const tab = await chrome.tabs.get(message.tabId);
      if (!/^https?:\/\//.test(tab.url || '')) throw new Error('请在普通网页的视频标签页启动听译');
      const origin = speechURL(settings.speechEndpoint).origin + '/*';
      if (!await chrome.permissions.contains({origins:[origin]})) throw new Error('请先保存设置并授权识别服务地址');
      if (!await offscreenExists()) await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['USER_MEDIA'],justification:'仅在用户点击开始后识别当前标签页音频并显示译文'});
      await sendOffscreen('offscreen-stop');
      const streamId = await chrome.tabCapture.getMediaStreamId({targetTabId:tab.id});
      return await sendOffscreen('offscreen-start',{streamId,tabId:tab.id,settings});
    } finally {speechStarting = false;}
  })().then(respond).catch(error => respond({ok:false,error:error.message}));
  return true;
});
chrome.storage.onChanged.addListener((changes,area) => {
  if (area !== 'local' || !changes.settings) return;
  // Stop before changing recognition/translation settings; user explicitly restarts.
  sendOffscreen('offscreen-stop').catch(() => {});
});
chrome.tabs?.onRemoved.addListener(() => {
  sendOffscreen('offscreen-status').then(async status => {
    if (!status.active) return;
    try {await chrome.tabs.get(status.tabId);} catch {await sendOffscreen('offscreen-stop');}
  }).catch(() => {});
});
chrome.tabs?.onUpdated.addListener((tabId,change) => {
  if (change.status !== 'loading') return;
  sendOffscreen('offscreen-status').then(status => {if (status.tabId === tabId) return sendOffscreen('offscreen-stop');}).catch(() => {});
});
