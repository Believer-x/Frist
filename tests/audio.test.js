import test from 'node:test';
import assert from 'node:assert/strict';
import {resample,encodeWav,speechURL} from '../extension/audio-utils.js';
test('downsamples 48 kHz audio to 16 kHz without changing duration', () => {
  const input = new Float32Array(48000).fill(0.25);
  const result = resample(input,48000);
  assert.equal(result.length,16000);
  assert.ok(result.every(x => Math.abs(x-0.25)<1e-6));
  assert.throws(() => resample(input,0));
});
test('encodes mono PCM16 WAV with clamped samples and correct header', async () => {
  const blob = encodeWav(new Float32Array([-2,-1,0,1,2]));
  const data = new DataView(await blob.arrayBuffer());
  assert.equal(blob.size,54);
  assert.equal(data.getUint32(24,true),16000);
  assert.equal(data.getUint16(22,true),1);
  assert.equal(data.getInt16(44,true),-32768);
  assert.equal(data.getInt16(52,true),32767);
  assert.equal(data.getUint32(40,true),10);
});
test('speech endpoint accepts only trusted transport and normalizes paths', () => {
  assert.equal(speechURL('http://127.0.0.1:8765/').href,'http://127.0.0.1:8765/transcribe');
  assert.equal(speechURL('https://example.com/api/transcribe').href,'https://example.com/api/transcribe');
  for (const value of ['http://example.com','file:///tmp/audio','https://key@example.com','https://example.com/?token=x']) assert.throws(() => speechURL(value));
});
