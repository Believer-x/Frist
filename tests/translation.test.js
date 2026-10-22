import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS, normalizeText, libreURL, translate} from '../extension/translation.js';
test('normalizes and bounds caption input', () => {
  assert.equal(normalizeText(' hello\n world '), 'hello world');
  assert.equal(normalizeText('x'.repeat(1500)).length, 1200);
});
test('accepts secure and local endpoints; refuses unsafe or credential-bearing URLs', () => {
  assert.equal(libreURL('https://example.com/api/'), 'https://example.com/api/translate');
  assert.equal(libreURL('http://localhost:5000/translate'), 'http://localhost:5000/translate');
  for (const value of ['http://example.com','file:///tmp/a','https://user:secret@example.com','https://example.com/?api_key=secret']) assert.throws(() => libreURL(value));
});
test('Google translation preserves multi-segment results and encodes input', async () => {
  const result = await translate('Hello & goodbye', DEFAULTS, async url => {
    assert.equal(new URL(url).searchParams.get('q'), 'Hello & goodbye');
    assert.equal(new URL(url).searchParams.get('tl'), 'zh-CN');
    return {ok: true, json: async () => [[['你好'],['，再见']]]};
  });
  assert.equal(result, '你好，再见');
});
test('LibreTranslate sends selected language and API key only in POST body', async () => {
  const result = await translate('Hello', {...DEFAULTS, provider: 'libre', endpoint: 'https://example.com', apiKey: 'test-key'}, async (url, init) => {
    assert.equal(url, 'https://example.com/translate');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), {q:'Hello',source:'auto',target:'zh',format:'text',api_key:'test-key'});
    assert.equal(init.redirect, 'error');
    return {ok:true,json:async () => ({translatedText:'你好'})};
  });
  assert.equal(result,'你好');
});
test('service errors and malformed translations fail explicitly', async () => {
  await assert.rejects(translate('Hello', DEFAULTS, async () => ({ok:false,status:429})), /限流/);
  await assert.rejects(translate('Hello', DEFAULTS, async () => ({ok:true,json:async () => []})), /有效文本/);
});
