// Executes the real AudioWorklet/offscreen/background/content code in Chromium.
// TabCapture and ASR responses are simulated; this is not a recognition-accuracy test.
import {chromium} from 'playwright';
import http from 'node:http';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULTS} from '../extension/translation.js';
let settings, overlay, requests = 0, healthReady = true;
const listeners = [];
globalThis.chrome = {
  runtime: {getURL:p => `chrome-extension://test/${p}`,onMessage:{addListener:fn => listeners.push(fn)}},
  storage: {local:{get:async () => ({settings})},onChanged:{addListener:() => {}}},
  permissions: {contains: async () => true}
};
await import('../extension/background.js');
async function message(payload) {
  if (payload.type === 'speech-event') {
    await overlay.evaluate(value => {
      window.receiver({...value,type:'speech-display'});
      window.storageHandler?.({speechState:{newValue:value}},'session');
    },payload);
    return {ok:true};
  }
  return new Promise(resolve => {if (!listeners.some(fn => fn(payload,{},resolve) === true)) resolve();});
}
const allowed = new Set(['offscreen.html','offscreen.js','audio-utils.js','capture-worklet.js']);
const server = http.createServer(async (req,res) => {
  if (req.url === '/health') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ready:healthReady}));return;}
  if (req.url.startsWith('/transcribe')) {
    const chunks=[];for await (const chunk of req) chunks.push(chunk);
    const data=Buffer.concat(chunks);requests++;
    assert.equal(data.toString('ascii',0,4),'RIFF');
    assert.equal(data.readUInt32LE(24),16000);
    assert.equal(data.readUInt16LE(22),1);
    assert.equal(data.length,128044,'four-second PCM16 chunk');
    let peak=0;for(let i=44;i<data.length;i+=2) peak=Math.max(peak,Math.abs(data.readInt16LE(i)));
    assert.ok(peak>100,'captured waveform is not silence');
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({text:'Hello world',language:'en'}));return;
  }
  if (req.url === '/translate') {
    let body='';for await(const part of req) body+=part;
    assert.equal(JSON.parse(body).q,'Hello world');
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({translatedText:'你好，世界'}));return;
  }
  const name = req.url.split('/').pop();
  if (allowed.has(name)) {
    res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/html');
    res.end(await readFile(new URL('../extension/'+name,import.meta.url)));return;
  }
  res.setHeader('Content-Type','text/html');res.end('<html><body><video width="640" height="360"></video></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
settings={...DEFAULTS,mode:'audio',provider:'libre',endpoint:origin,speechEndpoint:origin};
let browser;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || '/usr/lib/chromium/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  const context=await browser.newContext();context.setDefaultTimeout(12000);
  await context.exposeBinding('bridgeMessage',(_,payload)=>message(payload));
  await context.addInitScript(() => {
    window.chrome={runtime:{sendMessage:msg=>window.bridgeMessage(msg),onMessage:{addListener:fn=>window.receiver=fn}},storage:{onChanged:{addListener:fn=>window.storageHandler=fn}}};
    const attach=Element.prototype.attachShadow;
    Element.prototype.attachShadow=function(options){return attach.call(this,{...options,mode:'open'});};
  });
  overlay=await context.newPage();await overlay.goto(origin);await overlay.addScriptTag({path:'extension/content.js'});
  const recorder=await context.newPage();
  await recorder.addInitScript(() => {
    navigator.mediaDevices.getUserMedia=async () => {
      window.fixtureContext=new AudioContext();
      window.fixtureOscillator=fixtureContext.createOscillator();
      const gain=fixtureContext.createGain();gain.gain.value=0.05;
      window.fixtureDestination=fixtureContext.createMediaStreamDestination();
      fixtureOscillator.connect(gain);gain.connect(fixtureDestination);fixtureOscillator.start();await fixtureContext.resume();
      return fixtureDestination.stream;
    };
  });
  await recorder.goto(origin+'/offscreen.html');
  await recorder.waitForFunction(()=>!!window.receiver);
  assert.equal(requests,0,'no audio uploaded before explicit start');
  const start = await recorder.evaluate(settings=>new Promise(resolve=>receiver({target:'offscreen',type:'offscreen-start',streamId:'test',tabId:1,settings},{},resolve)),settings);
  assert.equal(start.ok,true);
  await overlay.waitForFunction(()=>document.querySelector('[data-subtitle-bridge]')?.shadowRoot.querySelector('.translation').textContent==='你好，世界');
  const host=overlay.locator('[data-subtitle-bridge]');
  assert.equal(await host.locator('.source').textContent(),'Hello world');
  const stopped=await recorder.evaluate(()=>new Promise(resolve=>receiver({target:'offscreen',type:'offscreen-stop'},{},resolve)));
  assert.equal(stopped.ok,true);
  assert.equal(await recorder.evaluate(()=>fixtureDestination.stream.getTracks().every(track=>track.readyState==='ended')),true);
  assert.equal(await host.evaluate(el=>el.style.display),'none');
  const count=requests;await new Promise(resolve=>setTimeout(resolve,4300));
  assert.equal(requests,count,'stop prevents further audio uploads');
  healthReady=false;
  const failed=await recorder.evaluate(settings=>new Promise(resolve=>receiver({target:'offscreen',type:'offscreen-start',streamId:'test',tabId:1,settings},{},resolve)),settings);
  assert.equal(failed.ok,false);
  assert.match(failed.error,/尚未就绪/);
  console.log('PASS: real AudioWorklet → resampled WAV → mock ASR HTTP → real translation handler → bilingual overlay; explicit start, stop releases tracks, no uploads after stop, unready service rejected. Tab capture and recognition are mocked.');
} finally {await browser?.close();server.close();}
