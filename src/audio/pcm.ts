// Float32 ↔ PCM16 + base64 helpers, used by main-thread playback/capture glue.
// The worklets re-implement the same logic in their own files (workers can't
// import) — keep both copies in sync.

/** Float32 [-1, 1] → Int16 little-endian PCM16. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    let s = input[i] ?? 0;
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Int16 PCM16 → Float32 [-1, 1]. */
export function pcm16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = input[i] ?? 0;
    out[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
  }
  return out;
}

/** Encode bytes as standard base64 (no URL-safe variant). */
export function bytesToBase64(bytes: Uint8Array): string {
  // btoa requires a binary string. For typical 20 ms frames (~960 bytes) the
  // String.fromCharCode.apply trick is fastest and well within argument-count
  // limits.
  let str = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    str += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)) as number[],
    );
  }
  return btoa(str);
}

/** Decode base64 → bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/** PCM16 Int16Array → base64 (little-endian, matches what voice-runtime2 expects). */
export function pcm16ToBase64(samples: Int16Array): string {
  // Int16Array is the native byte order. On every supported browser this is
  // little-endian. Use a Uint8 view to avoid an extra copy.
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  return bytesToBase64(bytes);
}

/** base64 → PCM16 Int16Array (allocates a fresh buffer). */
export function base64ToPcm16(b64: string): Int16Array {
  const bytes = base64ToBytes(b64);
  // Copy into a fresh buffer so the Int16Array view is correctly aligned.
  const aligned = new Uint8Array(bytes.length);
  aligned.set(bytes);
  return new Int16Array(aligned.buffer, 0, aligned.length / 2);
}
