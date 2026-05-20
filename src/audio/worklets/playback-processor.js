// Playback-side AudioWorklet processor.
//
// Maintains a small ring buffer of PCM16 24 kHz samples received from the
// main thread, resamples to the AudioContext rate on output, and writes
// Float32 frames to the output bus.
//
// On {kind:"clear"} from the main thread (barge-in or end_call), drops every
// queued sample immediately.

const SOURCE_SR = 24000;
// Target jitter buffer ~80 ms.
const MAX_QUEUE_SAMPLES = SOURCE_SR * 2; // ~2 s ceiling; should never get close.

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = new Float32Array(MAX_QUEUE_SAMPLES);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
    this.ratio = SOURCE_SR / sampleRate; // < 1 when upsampling for 48k output
    this.readPos = 0;
    this.lastSample = 0;

    this.port.onmessage = (ev) => {
      const data = ev.data;
      if (!data) return;
      if (data.kind === "audio" && data.buffer) {
        const pcm = new Int16Array(data.buffer);
        this.enqueue(pcm);
      } else if (data.kind === "clear") {
        this.head = 0;
        this.tail = 0;
        this.count = 0;
        this.readPos = 0;
        this.lastSample = 0;
      }
    };
  }

  enqueue(pcm) {
    // Convert Int16 → Float32 and append to ring buffer.
    const cap = this.queue.length;
    for (let i = 0; i < pcm.length; i++) {
      if (this.count >= cap) {
        // Overflow — drop oldest sample.
        this.head = (this.head + 1) % cap;
        this.count--;
      }
      const v = pcm[i];
      this.queue[this.tail] = v < 0 ? v / 0x8000 : v / 0x7fff;
      this.tail = (this.tail + 1) % cap;
      this.count++;
    }
  }

  read() {
    if (this.count === 0) return 0;
    const v = this.queue[this.head];
    this.lastSample = v;
    return v;
  }

  advance(n) {
    this.head = (this.head + n) % this.queue.length;
    this.count = Math.max(0, this.count - n);
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const channelData = out[0];
    if (!channelData) return true;
    const frames = channelData.length;

    if (Math.abs(this.ratio - 1) < 1e-6) {
      // 1:1 — context is 24 kHz.
      for (let i = 0; i < frames; i++) {
        if (this.count > 0) {
          channelData[i] = this.queue[this.head];
          this.head = (this.head + 1) % this.queue.length;
          this.count--;
        } else {
          channelData[i] = 0;
        }
      }
      // Mirror to right channel if present.
      for (let c = 1; c < out.length; c++) {
        const ch = out[c];
        if (ch) ch.set(channelData);
      }
      return true;
    }

    // Resample with linear interpolation. readPos is a fractional index into
    // the ring buffer counted from the current head.
    for (let i = 0; i < frames; i++) {
      const i0 = Math.floor(this.readPos);
      const t = this.readPos - i0;
      // Need samples i0 and i0+1 available in the queue.
      if (i0 + 1 >= this.count) {
        channelData[i] = this.count > 0 ? this.lastSample : 0;
      } else {
        const a = this.queue[(this.head + i0) % this.queue.length];
        const b = this.queue[(this.head + i0 + 1) % this.queue.length];
        channelData[i] = a * (1 - t) + b * t;
        this.lastSample = channelData[i];
      }
      this.readPos += this.ratio;
    }
    // Advance the head past consumed whole samples.
    const consumed = Math.floor(this.readPos);
    if (consumed > 0) {
      const c = Math.min(consumed, this.count);
      this.head = (this.head + c) % this.queue.length;
      this.count -= c;
      this.readPos -= consumed;
    }
    for (let c = 1; c < out.length; c++) {
      const ch = out[c];
      if (ch) ch.set(channelData);
    }
    return true;
  }
}

registerProcessor("vocadesk-playback", PlaybackProcessor);
