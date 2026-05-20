// Microphone capture pipeline.
//
//   getUserMedia → MediaStreamSource → CaptureProcessor (worklet)
//      → main thread: PCM16 ArrayBuffer → base64 → WS
//      → main thread: rms → meter callback
//
// The worklet handles downsampling to 24 kHz (some browsers — notably Safari
// — refuse to honour AudioContext({sampleRate:24000}) so we run at the device
// rate and resample inside the worklet).

import workletSource from "./worklets/capture-processor.js?raw";
import { pcm16ToBase64 } from "./pcm.js";

export interface CaptureHandlers {
  onAudio(b64: string): void;
  onMeter(rms: number): void;
}

export interface CaptureSession {
  stop(): void;
}

let cachedWorkletBlobUrl: string | null = null;
function getWorkletBlobUrl(source: string): string {
  if (cachedWorkletBlobUrl) return cachedWorkletBlobUrl;
  const blob = new Blob([source], { type: "application/javascript" });
  cachedWorkletBlobUrl = URL.createObjectURL(blob);
  return cachedWorkletBlobUrl;
}

/** Detect support for AudioContext + audioWorklet. */
export function isAudioSupported(): boolean {
  const AC =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return !!AC;
}

interface MicSession {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  node: AudioWorkletNode;
}

export async function startCapture(handlers: CaptureHandlers): Promise<CaptureSession> {
  const AC =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) throw new Error("AudioContext not supported");

  // Request the device mic. Echo cancellation + noise suppression let browsers
  // pre-clean the signal — this matches what /direct/test-call expects (the
  // server-side RNNoise denoiser is OFF on the direct path).
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
    video: false,
  });

  // Try the desired sample rate first; fall back to the device default if the
  // browser refuses (Safari ignores the hint and runs at 48 kHz).
  let context: AudioContext;
  try {
    context = new AC({ sampleRate: 24000 });
  } catch {
    context = new AC();
  }
  // Some browsers leave the context suspended until a user gesture. We were
  // called from a click handler, so this should resume cleanly.
  if (context.state === "suspended") {
    try {
      await context.resume();
    } catch {
      /* ignore — capture may still work */
    }
  }

  await context.audioWorklet.addModule(getWorkletBlobUrl(workletSource));

  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "vocadesk-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
    processorOptions: { inputSampleRate: context.sampleRate },
  });
  source.connect(node);

  node.port.onmessage = (ev: MessageEvent<unknown>) => {
    const data = ev.data as { kind?: string; buffer?: ArrayBuffer; rms?: number };
    if (data.kind === "audio" && data.buffer) {
      const pcm = new Int16Array(data.buffer);
      handlers.onAudio(pcm16ToBase64(pcm));
    } else if (data.kind === "meter" && typeof data.rms === "number") {
      handlers.onMeter(data.rms);
    }
  };

  const session: MicSession = { stream, context, source, node };
  let stopped = false;
  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      try {
        session.node.port.onmessage = null;
        session.node.disconnect();
      } catch {
        /* ignore */
      }
      try {
        session.source.disconnect();
      } catch {
        /* ignore */
      }
      for (const t of session.stream.getTracks()) {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      }
      try {
        void session.context.close();
      } catch {
        /* ignore */
      }
    },
  };
}
