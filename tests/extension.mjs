import {chromium} from 'playwright';
import http from 'node:http';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const fixture = process.env.VIDEO_FIXTURE;
if (!fixture) throw new Error('Set VIDEO_FIXTURE to a small playable WebM file (see README).');
let calls = 0;
const server = http.createServer(async (req,res) => {
  if (req.url === '/translate') {
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body); calls++;
    if (input.q === 'Slow subtitle') await new Promise(resolve => setTimeout(resolve, 900));
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({translatedText: input.q === 'Hello world' ? '你好，世界' : '旧的翻译'}));
  } else if (req.url === '/video.webm') {res.setHeader('Content-Type','video/webm');res.end(await readFile(fixture));}
  else {res.setHeader('Content-Type','text/html');res.end('<html><body><video muted autoplay loop width="640" height="360" src="/video.webm"></video></body></html>');}
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(tmpdir(),'subtitle-bridge-'));
let context;
try {
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile,{executablePath: process.env.CHROMIUM_PATH || '/usr/lib/chromium/chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-sandbox','--enable-unsafe-extension-debugging','--autoplay-policy=no-user-gesture-required'],ignoreDefaultArgs:['--disable-extensions']});
  if (!context.serviceWorkers().length) {
    const session = await context.browser().newBrowserCDPSession();
    await session.send('Extensions.loadUnpacked', {path: extension});
  }
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator('#provider').selectOption('libre');
  await popup.locator('#endpoint').fill(origin);
  // Seed an optional permission through Chrome's extension API in a user gesture.
  // Headless Chromium automatically grants this permission on a button click.
  await popup.locator('button').click();
  await popup.waitForFunction(() => document.querySelector('#status').textContent.includes('已保存'));
  const settings = await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
  assert.equal(settings.provider,'libre');
  const page = await context.newPage();
  // Capture the closed shadow root to inspect only the extension output in this test.
  await page.addInitScript(() => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) {return original.call(this,{...options,mode:'open'});};
  });
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector('video').currentTime > 0);
  await page.evaluate(() => {
    const track = document.querySelector('video').addTextTrack('subtitles','English','en');
    track.mode = 'showing';
    track.addCue(new VTTCue(0,100,'Hello world'));
    window.testTrack = track;
  });
  // Isolated-world shadow roots stay closed; inspect rendered text through accessibility.
  const getOverlay = () => page.locator('[data-subtitle-bridge]');
  await page.waitForFunction(() => document.querySelector('[data-subtitle-bridge]')?.style.display === 'block');
  await new Promise(resolve => setTimeout(resolve, 900));
  assert.equal(calls,1,'caption translated once');
  // Service worker reply verifies the same cached translation used by the overlay.
  const result = await popup.evaluate(() => chrome.runtime.sendMessage({type:'translate',text:'Hello world'}));
  assert.equal(result.text,'你好，世界');
  assert.equal(calls,1,'cache avoids repeated network calls');
  await page.evaluate(() => {testTrack.removeCue(testTrack.cues[0]); testTrack.addCue(new VTTCue(0,100,'Slow subtitle'));});
  await new Promise(resolve => setTimeout(resolve,550));
  await page.evaluate(() => {testTrack.removeCue(testTrack.cues[0]);});
  await new Promise(resolve => setTimeout(resolve,1200));
  assert.equal(await getOverlay().evaluate(el => el.style.display),'none','stale response cannot show after cue ends');
  await popup.locator('#enabled').uncheck();
  await page.evaluate(() => testTrack.addCue(new VTTCue(0,100,'Hello world')));
  await new Promise(resolve => setTimeout(resolve,700));
  assert.equal(await getOverlay().evaluate(el => el.style.display),'none','disabled state hides captions');
  await popup.reload();
  assert.equal(await popup.locator('#enabled').isChecked(),false,'settings persist');
  console.log('PASS: extension load, popup settings, host permission, native captions, local translation service, cache, stale-response suppression, pause, persistence');
} finally {
  await context?.close(); server.close(); await rm(profile,{recursive:true,force:true});
}
