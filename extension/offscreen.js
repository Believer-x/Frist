import {encodeWav,resample,speechURL} from './audio-utils.js';
let session;
let generation = 0;
async function emit(value, token = generation) {
  if (token !== generation || !session) return;
  await chrome.runtime.sendMessage({type:'speech-event',tabId:session.tabId,metrics:session.lastMetrics,...value}).catch(() => {});
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
async function failure(current, error, stage, token) {
  if (token !== generation || session !== current) return;
  const key = stage + 'Failures';
  current[key] = (current[key] || 0) + 1;
  const message = error.name === 'AbortError' ? '语音识别超时' : error.message === 'Failed to fetch' ? '无法连接识别服务，请确认本机服务已启动' : error.message;
  await emit({state:'error',error:message},token);
  if (current[key] >= 3) await stop(message);
}
// One recognition request and one translation may run concurrently. Each stage
// retains only its newest pending item, so a slow provider cannot build a backlog.
async function translateChunk(job, token) {
  if (token !== generation || !session) return;
  const current = session;
  if (current.translationBusy) {current.nextTranslation = job;return;}
  if (Date.now() - job.capturedAt > 8000) return;
  current.translationBusy = true;
  try {
    await emit({state:'translating',text:job.text},token);
    const started = performance.now();
    const result = await chrome.runtime.sendMessage({type:'translate',text:job.text});
    if (token !== generation || session !== current) return;
    if (!result?.ok) throw new Error(result?.error || '翻译失败');
    if (Date.now() - job.capturedAt > 8000) throw new Error('翻译服务响应过慢，已丢弃过期结果；请更换更快的翻译服务');
    current.lastMetrics = {audioMs:job.audioMs,recognitionMs:job.recognitionMs,translationMs:Math.round(performance.now()-started),latencyMs:Math.round(Date.now()-job.capturedAt+job.audioMs)};
    await emit({state:'result',text:job.text,translation:result.text},token);
    current.translationFailures = 0;
  } catch (error) {await failure(current,error,'translation',token);}
  finally {
    current.translationBusy = false;
    const next = current.nextTranslation;current.nextTranslation = null;
    if (next && token === generation) translateChunk(next,token);
  }
}
async function processChunk(samples, capturedAt, token) {
  if (token !== generation || !session) return;
  const current = session;
  if (current.busy) {current.pending = {samples,capturedAt}; return;}
  if (Date.now() - capturedAt > 3000) return;
  let energy = 0; for (const value of samples) energy += value * value;
  if (Math.sqrt(energy / samples.length) < 0.004) return;
  current.busy = true;
  try {
    const data = resample(samples,current.context.sampleRate);
    const url = speechURL(current.settings.speechEndpoint);
    const language = current.settings.source === 'auto' ? (Date.now() < current.detectedLanguageUntil ? current.detectedLanguage : 'auto') : current.settings.source.split('-')[0];
    url.searchParams.set('language',language);
    current.controller = new AbortController();
    const timer = setTimeout(() => current.controller?.abort(),15000);
    const started = performance.now();
    let result;
    try {
      const response = await fetch(url,{method:'POST',body:encodeWav(data),headers:{'Content-Type':'audio/wav'},signal:current.controller.signal,credentials:'omit',redirect:'error'});
      if (!response.ok) throw new Error(`语音识别服务返回 HTTP ${response.status}`);
      result = await response.json();
    } finally {clearTimeout(timer);}
    if (token !== generation || session !== current) return;
    if (Date.now() - capturedAt > 8000) throw new Error('语音识别延迟过高，请重启服务使用 tiny 模型，或指定原语言');
    const text = typeof result.text === 'string' ? result.text.trim().slice(0,1200) : '';
    if (language === 'auto' && /^[a-z]{2,3}$/.test(result.language || '') && result.language_probability >= .65) {
      current.detectedLanguage = result.language;current.detectedLanguageUntil = Date.now() + 30000;
    }
    current.recognitionFailures = 0;
    if (!text) return;
    // Do not await translation here: recognition can immediately process more audio.
    translateChunk({text,capturedAt,audioMs:samples.length/current.context.sampleRate*1000,recognitionMs:Math.round(performance.now()-started)},token);
  } catch (error) {await failure(current,error,'recognition',token);}
  finally {
    current.busy = false;
    const pending = current.pending;current.pending = null;
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
