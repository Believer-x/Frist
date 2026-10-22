// Browser integration harness: real content/popup/background code; mocked Chrome APIs.
import {chromium} from 'playwright';
import http from 'node:http';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULTS} from '../extension/translation.js';
const fixture = process.env.VIDEO_FIXTURE;
if (!fixture) throw new Error('Set VIDEO_FIXTURE to a playable WebM fixture.');
let calls = 0, listener;
let settings;
globalThis.chrome = {
  runtime: {onMessage: {addListener: fn => listener = fn}},
  storage: {local: {get: async () => ({settings})}, onChanged: {addListener: () => {}}},
  permissions: {contains: async () => true}
};
await import('../extension/background.js');
function message(payload) {return new Promise(resolve => listener(payload, {}, resolve));}
const server = http.createServer(async (req,res) => {
  if (req.url === '/translate') {
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body); calls++;
    if (input.q === 'Slow subtitle') await new Promise(resolve => setTimeout(resolve,900));
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({translatedText: input.q === 'Hello world' ? '你好，世界' : '旧的翻译'}));
  } else if (req.url === '/video.webm') {res.setHeader('Content-Type','video/webm');res.end(await readFile(fixture));}
  else if (req.url.startsWith('/extension/')) {
    const name = req.url.split('/').pop();
    if (!['popup.html','popup.css','popup.js','translation.js'].includes(name)) {res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
    res.end(await readFile(new URL('../extension/' + name,import.meta.url)));
  } else {res.setHeader('Content-Type','text/html');res.end('<html><body><video muted autoplay loop width="640" height="360" src="/video.webm"></video></body></html>');}
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
settings = {...DEFAULTS,provider:'libre',endpoint:origin};
let browser;
try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/lib/chromium/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  const context = await browser.newContext();
  context.setDefaultTimeout(10000);
  await context.exposeBinding('bridgeMessage',(_,payload) => message(payload));
  await context.exposeBinding('bridgeRead',() => ({settings}));
  await context.exposeBinding('bridgeSave',async (_,data) => {
    settings = data.settings;
    for (const page of context.pages()) await page.evaluate(() => window.storageListeners.forEach(fn => fn()));
  });
  await context.addInitScript(() => {
    window.storageListeners = [];
    window.chrome = {runtime:{sendMessage: payload => window.bridgeMessage(payload)},storage:{local:{get: () => window.bridgeRead(),set: data => window.bridgeSave(data)},onChanged:{addListener: fn => storageListeners.push(fn)}},permissions:{request:async () => true}};
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) {return attach.call(this,{...options,mode:'open'});};
  });
  const page = await context.newPage();
  page.on('pageerror', error => console.error('Page error:',error.message));
  await page.goto(origin);
  await page.addScriptTag({path:'extension/content.js'});
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0);
  await page.evaluate(() => {
    window.testTrack = document.querySelector('video').addTextTrack('subtitles','English','en');
    testTrack.mode='showing';testTrack.addCue(new VTTCue(0,100,'Hello world'));
  });
  const host = page.locator('[data-subtitle-bridge]');
  console.log('Fixture playing, waiting for translated cue');
  await page.waitForFunction(() => document.querySelector('[data-subtitle-bridge]')?.shadowRoot.querySelector('.translation').textContent === '你好，世界');
  assert.equal(await host.locator('.source').textContent(),'Hello world');
  await new Promise(resolve => setTimeout(resolve,650));
  assert.equal(calls,1,'stable cue translated once');
  assert.equal((await message({type:'translate',text:'Hello world'})).text,'你好，世界');
  assert.equal(calls,1,'cache reused');
  await page.evaluate(() => {testTrack.removeCue(testTrack.cues[0]);testTrack.addCue(new VTTCue(0,100,'Slow subtitle'));});
  await new Promise(resolve => setTimeout(resolve,600));
  await page.evaluate(() => testTrack.removeCue(testTrack.cues[0]));
  await new Promise(resolve => setTimeout(resolve,1200));
  assert.equal(await host.evaluate(el => el.style.display),'none','expired response stays hidden');
  console.log('Caption rendering, cache and stale-response checks passed');
  const popup = await context.newPage(); await popup.goto(origin+'/extension/popup.html');
  await popup.locator('#enabled').uncheck();
  await page.evaluate(() => testTrack.addCue(new VTTCue(0,100,'Hello world')));
  await new Promise(resolve => setTimeout(resolve,650));
  assert.equal(await host.evaluate(el => el.style.display),'none','pause hides subtitle');
  await popup.reload();assert.equal(await popup.locator('#enabled').isChecked(),false);
  await popup.locator('#enabled').check();
  await page.waitForFunction(() => document.querySelector('[data-subtitle-bridge]').shadowRoot.querySelector('.translation').textContent === '你好，世界' && document.querySelector('[data-subtitle-bridge]').style.display === 'block');
  await popup.locator('#bilingual').uncheck();await popup.locator('button').click();
  await page.waitForFunction(() => document.querySelector('[data-subtitle-bridge]').shadowRoot.querySelector('.source').style.display === 'none');
  await page.evaluate(() => {
    for (const cue of [...testTrack.cues]) testTrack.removeCue(cue);
    const caption = document.createElement('span'); caption.className='ytp-caption-segment'; caption.textContent='DOM subtitle'; document.body.append(caption);
  });
  await page.waitForFunction(() => document.querySelector('[data-subtitle-bridge]').style.display === 'block' && document.querySelector('[data-subtitle-bridge]').shadowRoot.querySelector('.translation').textContent === '旧的翻译');
  await popup.setViewportSize({width:370,height:900});
  await popup.screenshot({path:'/tmp/subtitle-bridge-popup.png',fullPage:true});
  console.log('PASS: browser harness — native cues, actual backend/local HTTP translation, rendered bilingual text, cache, stale response, popup pause/resume, saved settings and bilingual toggle. Chrome APIs are mocked; extension loading is a separate test.');
} finally {await browser?.close();server.close();}
