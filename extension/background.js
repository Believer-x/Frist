import {DEFAULTS, normalizeText, translate, libreURL} from './translation.js';
const cache = new Map();
const pending = new Map();
let active = 0;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['public-settings', 'translate'].includes(message?.type)) return;
  (async () => {
    const settings = {...DEFAULTS, ...(await chrome.storage.local.get('settings')).settings};
    if (message.type === 'public-settings') {
      const {enabled, bilingual} = settings;
      return {ok: true, settings: {enabled, bilingual}};
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
chrome.storage.onChanged.addListener(() => cache.clear());
