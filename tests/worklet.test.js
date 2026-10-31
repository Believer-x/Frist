import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../extension/capture-worklet.js',import.meta.url),'utf8');
function recorder() {
  let Processor, elapsed = 0;
  const chunks = [];
  vm.runInNewContext(source,{sampleRate:16000,Float32Array,AudioWorkletProcessor:class {
    constructor() {this.port={postMessage:data=>chunks.push({data:new Float32Array(data),at:elapsed})};}
  },registerProcessor:(_,Class)=>{Processor=Class;}});
  const node = new Processor();
  return {chunks,feed(seconds,value) {
    const blocks = Math.ceil(seconds*16000/128);
    for(let i=0;i<blocks;i++) {elapsed+=128/16000;node.process([[new Float32Array(128).fill(value)]]);}
  }};
}
test('continuous speech is submitted within 1.5 seconds, preserving sample order',()=>{
  const r=recorder();r.feed(3.1,.1);
  assert.equal(r.chunks.length,2);
  assert.ok(r.chunks[0].at<=1.51);
  for(const chunk of r.chunks) {
    assert.equal(chunk.data.length,24000);
    assert.ok(chunk.data.every(x=>Math.abs(x-.1)<1e-6));
  }
});
test('short phrase flushes after a 200ms pause and includes quiet pre-roll',()=>{
  const r=recorder();r.feed(.4,0);r.feed(.3,.1);r.feed(.22,0);
  assert.equal(r.chunks.length,1);
  assert.ok(r.chunks[0].at<1);
  assert.ok(r.chunks[0].data.length<16000);
  assert.equal(r.chunks[0].data[0],0);
  assert.ok(r.chunks[0].data.some(x=>x>.09));
  r.feed(2,0);assert.equal(r.chunks.length,1,'silence does not produce repeated uploads');
});
test('silence alone never sends audio for recognition',()=>{
  const r=recorder();r.feed(10,0);assert.equal(r.chunks.length,0);
});
