import {DEFAULTS, libreURL} from './translation.js';
const $ = id => document.getElementById(id);
const fields = ['enabled','source','target','bilingual','provider','endpoint','apiKey'];
function visibility() {
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
  const button = document.querySelector('button');
  button.disabled = true;
  $('status').className = '';
  try {
    const next = Object.fromEntries(fields.map(name => [name, typeof DEFAULTS[name] === 'boolean' ? $(name).checked : $(name).value.trim()]));
    if (next.provider === 'libre') {
      next.endpoint = libreURL(next.endpoint);
      const granted = await chrome.permissions.request({origins: [new URL(next.endpoint).origin + '/*']});
      if (!granted) throw new Error('未获得服务访问权限，设置未保存');
    }
    await chrome.storage.local.set({settings: next});
    $('status').textContent = '已保存，将应用到已打开的视频页面';
  } catch (error) {
    $('status').className = 'error';
    $('status').textContent = error instanceof TypeError ? '请输入有效的翻译服务地址' : error.message;
  } finally {button.disabled = false;}
});
