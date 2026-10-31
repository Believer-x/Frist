// Flush on a speech pause instead of waiting for a fixed four-second block.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(Math.round(sampleRate * 1.5));
    this.offset = 0;
    this.speaking = false;
    this.quiet = 0;
    this.preRoll = new Float32Array(Math.round(sampleRate * .1));
    this.preOffset = 0;
    this.preCount = 0;
  }
  publish(keepSpeaking) {
    if (!this.offset) return;
    const samples = this.buffer.slice(0,this.offset);
    this.port.postMessage(samples,[samples.buffer]);
    this.offset = 0; this.quiet = 0; this.speaking = keepSpeaking;
    this.preCount = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    const size = channels[0].length;
    let energy = 0;
    for (let i = 0; i < size; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      energy += (value / channels.length) ** 2;
    }
    const voiced = Math.sqrt(energy / size) >= .004;
    if (voiced && !this.speaking) {
      const start = (this.preOffset - this.preCount + this.preRoll.length) % this.preRoll.length;
      for (let i = 0; i < this.preCount; i++) this.buffer[this.offset++] = this.preRoll[(start+i)%this.preRoll.length];
      this.speaking = true; this.preCount = 0;
    }
    for (let i = 0; i < size; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      value /= channels.length;
      if (this.speaking) {
        this.buffer[this.offset++] = value;
        if (this.offset === this.buffer.length) this.publish(voiced);
      } else {
        this.preRoll[this.preOffset] = value;
        this.preOffset = (this.preOffset + 1) % this.preRoll.length;
        this.preCount = Math.min(this.preCount + 1,this.preRoll.length);
      }
    }
    this.quiet = voiced ? 0 : this.quiet + size;
    if (this.speaking && this.quiet >= sampleRate * .2 && this.offset >= sampleRate * .35) this.publish(false);
    return true;
  }
}
registerProcessor('subtitle-capture', CaptureProcessor);
