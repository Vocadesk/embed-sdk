// Server → speaker playback pipeline.
//
//   WS audio frame → base64 decode → PCM16 → PlaybackProcessor (worklet)
//   PlaybackProcessor maintains a small jitter buffer and outputs Float32.
//   On `{type:"clear"}` from the server, we postMessage {kind:"clear"} which
//   flushes the worklet's buffer immediately.

import workletSource from "./worklets/playback-processor.js?raw";
import { base64ToPcm16 } from "./pcm.js";

export interface PlaybackSession {
  enqueue(b64: string): void;
  clear(): void;
  stop(): void;
}

let cachedWorkletBlobUrl: string | null = null;
function getWorkletBlobUrl(source: string): string {
  if (cachedWorkletBlobUrl) return cachedWorkletBlobUrl;
  const blob = new Blob([source], { type: "application/javascript" });
  cachedWorkletBlobUrl = URL.createObjectURL(blob);
  return cachedWorkletBlobUrl;
}

export async function startPlayback(): Promise<PlaybackSession> {
  const AC =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) throw new Error("AudioContext not supported");

  let context: AudioContext;
  try {
    context = new AC({ sampleRate: 24000 });
  } catch {
    context = new AC();
  }
  if (context.state === "suspended") {
    try {
      await context.resume();
    } catch {
      /* ignore */
    }
  }

  await context.audioWorklet.addModule(getWorkletBlobUrl(workletSource));

  const node = new AudioWorkletNode(context, "vocadesk-playback", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  node.connect(context.destination);

  let stopped = false;
  return {
    enqueue(b64: string): void {
      if (stopped) return;
      const pcm = base64ToPcm16(b64);
      // Transfer the underlying buffer to avoid a copy on the worklet side.
      const buf = pcm.buffer;
      node.port.postMessage({ kind: "audio", buffer: buf }, [buf]);
    },
    clear(): void {
      if (stopped) return;
      node.port.postMessage({ kind: "clear" });
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      try {
        node.port.onmessage = null;
        node.disconnect();
      } catch {
        /* ignore */
      }
      try {
        void context.close();
      } catch {
        /* ignore */
      }
    },
  };
}
