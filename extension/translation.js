export const DEFAULTS = Object.freeze({mode: 'audio', speechEndpoint: 'http://127.0.0.1:8765', enabled: true, target: 'zh-CN', source: 'auto', bilingual: true, provider: 'google', endpoint: '', apiKey: ''});
export function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200);
}
export function libreURL(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('翻译地址必须使用 HTTPS，或本机 HTTP 地址');
  if (url.username || url.password || url.search || url.hash) throw new Error('翻译地址不能包含账号、查询参数或片段');
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/translate') ? path : path + '/translate';
  return url.href;
}
export async function translate(text, settings, fetcher = fetch) {
  const signal = AbortSignal.timeout(12000);
  let response;
  if (settings.provider === 'libre') {
    const body = {q: text, source: settings.source, target: settings.target === 'zh-CN' || settings.target === 'zh-TW' ? 'zh' : settings.target, format: 'text'};
    if (settings.apiKey) body.api_key = settings.apiKey;
    response = await fetcher(libreURL(settings.endpoint), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal, credentials: 'omit', redirect: 'error'});
  } else {
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.search = new URLSearchParams({client: 'gtx', sl: settings.source, tl: settings.target, dt: 't', q: text});
    response = await fetcher(url.href, {signal, credentials: 'omit', redirect: 'error'});
  }
  if (!response.ok) throw new Error(response.status === 429 ? '翻译服务限流，请稍后重试' : `翻译服务返回 HTTP ${response.status}`);
  const data = await response.json();
  const result = settings.provider === 'libre' ? data.translatedText : data?.[0]?.map(part => part?.[0] ?? '').join('');
  if (typeof result !== 'string' || !result.trim()) throw new Error('翻译服务未返回有效文本');
  return result.trim();
}
