import { describe, it, expect } from "vitest";
import {
  floatToPcm16,
  pcm16ToFloat,
  pcm16ToBase64,
  base64ToPcm16,
  bytesToBase64,
  base64ToBytes,
} from "../../src/audio/pcm.js";

describe("pcm codec", () => {
  it("round-trips float ↔ pcm16 within quantization error", () => {
    const input = new Float32Array([0, 0.5, -0.5, 1, -1, 0.123, -0.123]);
    const pcm = floatToPcm16(input);
    const back = pcm16ToFloat(pcm);
    for (let i = 0; i < input.length; i++) {
      const inV = input[i] ?? 0;
      const outV = back[i] ?? 0;
      expect(Math.abs(inV - outV)).toBeLessThan(1 / 32768);
    }
  });

  it("clips out-of-range floats", () => {
    const pcm = floatToPcm16(new Float32Array([2, -2, 1.0001, -1.0001]));
    expect(pcm[0]).toBe(0x7fff);
    expect(pcm[1]).toBe(-0x8000);
    expect(pcm[2]).toBe(0x7fff);
    expect(pcm[3]).toBe(-0x8000);
  });

  it("round-trips bytes ↔ base64", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const b64 = bytesToBase64(bytes);
    const back = base64ToBytes(b64);
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  it("round-trips pcm16 ↔ base64", () => {
    const samples = new Int16Array([0, 100, -100, 32767, -32768, 1234, -1234]);
    const b64 = pcm16ToBase64(samples);
    const back = base64ToPcm16(b64);
    expect(Array.from(back)).toEqual(Array.from(samples));
  });

  it("handles large frames", () => {
    const samples = new Int16Array(480); // 20 ms @ 24 kHz
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 0.1) * 10000;
    const b64 = pcm16ToBase64(samples);
    const back = base64ToPcm16(b64);
    expect(back.length).toBe(samples.length);
    for (let i = 0; i < samples.length; i++) expect(back[i]).toBe(samples[i]);
  });
});
