import {DEFAULTS, libreURL} from './translation.js';
import {speechURL} from './audio-utils.js';
const $ = id => document.getElementById(id);
const fields = ['mode','speechEndpoint','enabled','source','target','bilingual','provider','endpoint','apiKey'];
function visibility() {
  $('speech').hidden = $('mode').value !== 'audio';
  $('custom').hidden = $('provider').value !== 'libre';
  $('privacy').hidden = $('provider').value === 'libre';
}
const settings = {...DEFAULTS, ...(await chrome.storage.local.get('settings')).settings};
for (const name of fields) {
  if (typeof DEFAULTS[name] === 'boolean') $(name).checked = settings[name];
  else $(name).value = settings[name];
}
visibility();
$('provider').addEventListener('change', visibility);
$('mode').addEventListener('change', visibility);
$('enabled').addEventListener('change', async () => {
  try {
    const saved = {...DEFAULTS, ...(await chrome.storage.local.get('settings')).settings, enabled: $('enabled').checked};
    await chrome.storage.local.set({settings: saved});
    $('status').className = '';
    $('status').textContent = saved.enabled ? '已开启自动翻译' : '已暂停翻译';
  } catch { $('status').textContent = '开关保存失败，请重试'; }
});
$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('save');
  button.disabled = true;
  $('status').className = '';
  try {
    const next = Object.fromEntries(fields.map(name => [name, typeof DEFAULTS[name] === 'boolean' ? $(name).checked : $(name).value.trim()]));
    const origins = [];
    if (next.mode === 'audio') {
      const url = speechURL(next.speechEndpoint);
      next.speechEndpoint = url.origin + url.pathname.replace(/\/transcribe$/,'');
      origins.push(url.origin + '/*');
    }
    if (next.provider === 'libre') {
      next.endpoint = libreURL(next.endpoint);
      origins.push(new URL(next.endpoint).origin + '/*');
    }
    if (origins.length && !await chrome.permissions.request({origins:[...new Set(origins)]})) throw new Error('未获得服务访问权限，设置未保存');
    await chrome.storage.local.set({settings: next});
    $('status').textContent = '已保存；听声模式请点击开始，字幕模式即时应用';
  } catch (error) {
    $('status').className = 'error';
    $('status').textContent = error instanceof TypeError ? '请输入有效的翻译服务地址' : error.message;
  } finally {button.disabled = false;}
});

async function speechStatus() {
  try {
    const result = await chrome.runtime.sendMessage({type:'speech-status'});
    if (!result?.ok) return;
    $('stopListen').disabled = !result.active;
    const state = result.speechState;
    $('speechStatus').textContent = result.active ? (state?.state === 'error' ? state.error : '● 正在采集标签页声音') : (state?.error || '尚未开始采集音频');
  } catch {}
}
$('listen').addEventListener('click', async () => {
  $('listen').disabled = true;
  $('speechStatus').textContent = '正在连接识别服务…';
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    const result = await chrome.runtime.sendMessage({type:'speech-start',tabId:tab.id});
    if (!result?.ok) throw new Error(result?.error || '启动听译失败');
    await speechStatus();
  } catch (error) {$('speechStatus').textContent = error.message;}
  finally {$('listen').disabled = false;}
});
$('stopListen').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({type:'speech-stop'});
  await speechStatus();
});
speechStatus();
setInterval(speechStatus,2000);
