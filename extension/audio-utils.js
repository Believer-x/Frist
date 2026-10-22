// Convert captured mono Float32 PCM to an interoperable 16 kHz PCM WAV.
export function resample(samples, fromRate, toRate = 16000) {
  if (!Number.isFinite(fromRate) || fromRate <= 0) throw new Error('Invalid sample rate');
  if (fromRate === toRate) return samples;
  const size = Math.floor(samples.length * toRate / fromRate);
  const output = new Float32Array(size);
  // Average each source interval when downsampling instead of alias-prone point sampling.
  for (let i = 0; i < size; i++) {
    const start = i * fromRate / toRate;
    const end = (i + 1) * fromRate / toRate;
    let sum = 0, weight = 0;
    for (let j = Math.floor(start); j < Math.ceil(end) && j < samples.length; j++) {
      const w = Math.min(j + 1, end) - Math.max(j, start);
      if (w > 0) {sum += samples[j] * w; weight += w;}
    }
    output[i] = weight ? sum / weight : 0;
  }
  return output;
}
export function encodeWav(samples, rate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((c,i) => view.setUint8(offset+i,c.charCodeAt(0)));
  text(0,'RIFF');view.setUint32(4,36+samples.length*2,true);text(8,'WAVE');text(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
  text(36,'data');view.setUint32(40,samples.length*2,true);
  samples.forEach((sample,i) => {const s = Math.max(-1,Math.min(1,sample));view.setInt16(44+i*2,s < 0 ? s*32768 : s*32767,true);});
  return new Blob([buffer],{type:'audio/wav'});
}
export function speechURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('识别地址需要 HTTPS 或本机 HTTP 地址');
  if (url.username || url.password || url.search || url.hash) throw new Error('识别地址不能包含账号、查询参数或片段');
  url.pathname = url.pathname.replace(/\/+$/,'').replace(/\/(transcribe|health)$/,'') + '/transcribe';
  return url;
}
