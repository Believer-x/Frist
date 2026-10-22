import {encodeWav,resample,speechURL} from './audio-utils.js';
let session;
let generation = 0;
async function emit(value, token = generation) {
  if (token !== generation || !session) return;
  await chrome.runtime.sendMessage({type:'speech-event',tabId:session.tabId,...value}).catch(() => {});
}
async function stop(error) {
  generation++;
  const old = session; session = null;
  if (!old) return;
  old.controller?.abort();
  old.node?.disconnect(); old.source?.disconnect();
  for (const track of old.stream?.getTracks() || []) track.stop();
  await old.context?.close().catch(() => {});
  await chrome.runtime.sendMessage({type:'speech-event',tabId:old.tabId,state:'stopped',error}).catch(() => {});
}
async function processChunk(samples, capturedAt, token) {
  if (token !== generation || !session) return;
  const current = session;
  if (current.busy) {current.pending = {samples,capturedAt}; return;}
  let energy = 0; for (const value of samples) energy += value * value;
  if (Math.sqrt(energy / samples.length) < 0.004) return;
  current.busy = true;
  try {
    const data = resample(samples,current.context.sampleRate);
    const url = speechURL(current.settings.speechEndpoint);
    url.searchParams.set('language',current.settings.source === 'auto' ? 'auto' : current.settings.source.split('-')[0]);
    current.controller = new AbortController();
    const timer = setTimeout(() => current.controller?.abort(),30000);
    let response;
    try {
      response = await fetch(url,{method:'POST',body:encodeWav(data),headers:{'Content-Type':'audio/wav'},signal:current.controller.signal,credentials:'omit',redirect:'error'});
    } finally {clearTimeout(timer);}
    if (!response.ok) throw new Error(`语音识别服务返回 HTTP ${response.status}`);
    const result = await response.json();
    if (token !== generation || !session || Date.now()-capturedAt > 20000) return;
    const text = typeof result.text === 'string' ? result.text.trim().slice(0,1200) : '';
    if (!text) {await emit({state:'listening',text:'',translation:''},token);return;}
    await emit({state:'translating',text},token);
    const translated = await chrome.runtime.sendMessage({type:'translate',text});
    if (Date.now()-capturedAt > 20000) {await emit({state:'error',error:'处理延迟过高，已丢弃过期语音；请使用更小的识别模型'},token);return;}
    if (!translated?.ok) throw new Error(translated?.error || '翻译失败');
    await emit({state:'result',text,translation:translated.text},token);
    current.failures = 0;
  } catch (error) {
    if (token === generation && session) {
      current.failures = (current.failures || 0) + 1;
      await emit({state:'error',error:error.name === 'AbortError' ? '语音识别超时' : error.message === 'Failed to fetch' ? '无法连接识别服务，请确认本机服务已启动' : error.message},token);
      if (current.failures >= 3) {await stop(error.message);return;}
    }
  } finally {
    current.busy = false;
    const pending = current.pending; current.pending = null;
    if (pending && token === generation) processChunk(pending.samples,pending.capturedAt,token);
  }
}
async function start(message) {
  await stop();
  const token = ++generation;
  const current = {tabId:message.tabId,settings:message.settings};
  session = current;
  try {
    const url = speechURL(message.settings.speechEndpoint);
    url.pathname = url.pathname.replace(/\/transcribe$/,'/health');
    const health = await fetch(url,{signal:AbortSignal.timeout(5000),credentials:'omit',redirect:'error'});
    if (!health.ok || !(await health.json()).ready) throw new Error('识别服务尚未就绪，请先启动本机 Whisper 服务');
    if (token !== generation) return;
    current.stream = await navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:message.streamId}},video:false});
    if (token !== generation) {current.stream.getTracks().forEach(t => t.stop());return;}
    current.context = new AudioContext();
    await current.context.audioWorklet.addModule('capture-worklet.js');
    current.source = current.context.createMediaStreamSource(current.stream);
    // Tab capture mutes original playback; relay it so users still hear their video.
    current.source.connect(current.context.destination);
    current.node = new AudioWorkletNode(current.context,'subtitle-capture');
    current.source.connect(current.node);current.node.connect(current.context.destination);
    current.node.port.onmessage = event => processChunk(event.data,Date.now(),token);
    current.stream.getAudioTracks()[0].onended = () => {if (token === generation) stop();};
    await current.context.resume();
    await emit({state:'listening'},token);
  } catch (error) {await emit({state:'error',error:error.message},token);await stop(error.message);throw error;}
}
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (message?.target !== 'offscreen') return;
  if (message.type === 'offscreen-status') {respond({ok:true,active:!!session,tabId:session?.tabId});return;}
  if (message.type === 'offscreen-stop') {stop().then(() => respond({ok:true}));return true;}
  if (message.type === 'offscreen-start') {start(message).then(() => respond({ok:true})).catch(error => respond({ok:false,error:error.message}));return true;}
});
