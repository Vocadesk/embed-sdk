// Capture-side AudioWorklet processor.
//
// Runs on every audio render quantum (128 samples). Buffers input, downsamples
// to 24 kHz if necessary, converts to PCM16, base64-encodes, and ships ~20 ms
// chunks to the main thread.
//
// Also computes an RMS-per-100ms level and ships it on a separate channel.
//
// This file is loaded into the AudioWorkletGlobalScope — no imports allowed,
// no DOM, no setTimeout. Authored as plain JS so the AudioWorklet runtime can
// execute it directly without a TS toolchain on the worklet side.

const TARGET_SR = 24000;
// 20 ms at 24 kHz = 480 samples = 960 bytes PCM16.
const FRAME_SAMPLES = 480;
// 100 ms meter window at 24 kHz.
const METER_SAMPLES = 2400;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.inputSampleRate = opts.inputSampleRate || sampleRate;
    this.ratio = this.inputSampleRate / TARGET_SR; // > 1 when downsampling
    // Resampler state.
    this.resampleAccum = 0;
    this.resampleCarry = 0;
    // Output buffer at 24 kHz.
    this.outBuf = new Float32Array(FRAME_SAMPLES * 4);
    this.outFilled = 0;
    // Meter accumulator.
    this.meterSumSq = 0;
    this.meterCount = 0;
  }

  // Linear-interpolation downsampler. Cheap and good enough for speech in a
  // worklet — we'd lose more quality from a poor anti-alias filter than we
  // gain. Browser also runs its own AGC/echo cancellation upstream.
  downsample(input) {
    const ratio = this.ratio;
    // Estimate output length conservatively.
    const estOut = Math.ceil(input.length / ratio) + 2;
    if (this.outFilled + estOut > this.outBuf.length) {
      const grown = new Float32Array((this.outFilled + estOut) * 2);
      grown.set(this.outBuf.subarray(0, this.outFilled));
      this.outBuf = grown;
    }

    let writeIdx = this.outFilled;
    let pos = this.resampleAccum; // fractional read index into `input`
    while (pos < input.length) {
      const i0 = Math.floor(pos);
      const i1 = i0 + 1;
      const t = pos - i0;
      const a = i0 < 0 ? this.resampleCarry : input[i0];
      const b = i1 < input.length ? input[i1] : a;
      this.outBuf[writeIdx++] = a * (1 - t) + b * t;
      pos += ratio;
    }
    this.resampleAccum = pos - input.length;
    this.resampleCarry = input[input.length - 1] || 0;
    this.outFilled = writeIdx;
  }

  // Convert Float32 → Int16, write to a Uint8 view, transfer to main thread.
  flushFrames() {
    while (this.outFilled >= FRAME_SAMPLES) {
      const frame = this.outBuf.subarray(0, FRAME_SAMPLES);
      const pcm = new Int16Array(FRAME_SAMPLES);
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        let s = frame[i];
        if (s > 1) s = 1;
        else if (s < -1) s = -1;
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      // Post the underlying ArrayBuffer transferable to avoid an extra copy.
      const buf = pcm.buffer;
      this.port.postMessage({ kind: "audio", buffer: buf }, [buf]);
      // Shift remaining samples down.
      this.outBuf.copyWithin(0, FRAME_SAMPLES, this.outFilled);
      this.outFilled -= FRAME_SAMPLES;
    }
  }

  updateMeter(input) {
    for (let i = 0; i < input.length; i++) {
      const s = input[i];
      this.meterSumSq += s * s;
    }
    this.meterCount += input.length;
    if (this.meterCount >= METER_SAMPLES) {
      const rms = Math.sqrt(this.meterSumSq / this.meterCount);
      this.port.postMessage({ kind: "meter", rms: rms });
      this.meterSumSq = 0;
      this.meterCount = 0;
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    // Meter on the pre-resample signal (cheaper and more accurate).
    this.updateMeter(channel);

    if (Math.abs(this.ratio - 1) < 1e-6) {
      // No resample needed — just copy into outBuf.
      if (this.outFilled + channel.length > this.outBuf.length) {
        const grown = new Float32Array((this.outFilled + channel.length) * 2);
        grown.set(this.outBuf.subarray(0, this.outFilled));
        this.outBuf = grown;
      }
      this.outBuf.set(channel, this.outFilled);
      this.outFilled += channel.length;
    } else {
      this.downsample(channel);
    }

    this.flushFrames();
    return true;
  }
}

registerProcessor("vocadesk-capture", CaptureProcessor);
