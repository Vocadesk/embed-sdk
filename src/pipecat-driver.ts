/**
 * Pipecat (LiveKit / WebRTC) driver. The browser POSTs its embed JWT to
 * voice-runtime2's /pipecat/embed endpoint, gets back a LiveKit room URL +
 * participant token, and joins the room via livekit-client. The agent
 * participant streams audio over WebRTC — drastically more robust than
 * raw PCM-over-WebSocket against network jitter.
 *
 * livekit-client is loaded at runtime from a public CDN (jsdelivr) so the
 * embed bundle stays small. The browser caches it across page loads.
 */

export interface PipecatDriverHandlers {
  /** Fires when the LiveKit room is connected. → state machine "active" */
  onCallStarted(): void;
  /** Fires on a clean hangup / server disconnect. → state machine "ended" */
  onCallEnded(durationMs: number): void;
  /** LiveKit / network error. */
  onError(message: string): void;
}

export interface PipecatDriver {
  /** End the call (user clicked hang up). Idempotent. */
  stop(): Promise<void>;
}

interface DispatchResponse {
  url: string;
  token: string;
  callId: string;
  roomName: string;
}

/**
 * Where the SDK loads livekit-client from at runtime. Pinned to a major
 * version so jsdelivr serves a stable file but customers still pick up
 * patch fixes. The browser caches this aggressively — first call pays
 * ~250 KB download, every subsequent call is instant.
 */
const LIVEKIT_CDN_URL =
  "https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.esm.mjs";

interface LiveKitTrack {
  kind: string;
  attach(): HTMLMediaElement;
}
interface LiveKitRoomEventMap {
  TrackSubscribed: string;
  Disconnected: string;
}
interface LiveKitRoom {
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  localParticipant: {
    setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
  };
}
interface LiveKitNamespace {
  Room: new (opts?: Record<string, unknown>) => LiveKitRoom;
  RoomEvent: LiveKitRoomEventMap;
  Track: { Kind: { Audio: string } };
}

let liveKitModulePromise: Promise<LiveKitNamespace> | null = null;
function loadLiveKit(): Promise<LiveKitNamespace> {
  if (!liveKitModulePromise) {
    liveKitModulePromise = import(/* @vite-ignore */ LIVEKIT_CDN_URL).then(
      (mod: unknown) => mod as LiveKitNamespace,
    );
  }
  return liveKitModulePromise;
}

/**
 * Dispatch the call (POST JWT → LiveKit creds), load livekit-client,
 * connect to the room, and enable the mic. Returns a handle the caller
 * can use to hang up.
 */
export async function startPipecatCall(args: {
  dispatchUrl: string;
  token: string;
  handlers: PipecatDriverHandlers;
}): Promise<PipecatDriver> {
  // 1. Dispatch — voice-runtime2 spawns the agent worker and returns
  //    LiveKit join credentials. Failures here surface as ws_failed so
  //    the UI shows an actionable error rather than a generic hang.
  let dispatchBody: DispatchResponse;
  try {
    const res = await fetch(args.dispatchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: args.token }),
    });
    if (!res.ok) {
      let message = `Dispatch failed (${res.status})`;
      try {
        const errBody = (await res.json()) as { detail?: { message?: string } | string };
        if (typeof errBody?.detail === "string") message = errBody.detail;
        else if (errBody?.detail?.message) message = errBody.detail.message;
      } catch {
        /* ignore body parse failures */
      }
      args.handlers.onError(message);
      throw new Error(message);
    }
    dispatchBody = (await res.json()) as DispatchResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Pipecat dispatch failed";
    args.handlers.onError(msg);
    throw err;
  }

  // 2. Load livekit-client from CDN. Cached after the first call.
  let lk: LiveKitNamespace;
  try {
    lk = await loadLiveKit();
  } catch (err) {
    const msg = `Failed to load LiveKit client: ${err instanceof Error ? err.message : "unknown"}`;
    args.handlers.onError(msg);
    throw err;
  }

  // 3. Connect to the LiveKit room. Agent audio comes through as
  //    subscribed remote tracks; we attach each to a hidden <audio>
  //    element so the browser plays it.
  const room = new lk.Room({ adaptiveStream: true, dynacast: true });
  const audioElements: HTMLAudioElement[] = [];
  let startedAtMs = 0;
  let endedFired = false;

  const fireEnded = () => {
    if (endedFired) return;
    endedFired = true;
    const durationMs = startedAtMs ? Date.now() - startedAtMs : 0;
    args.handlers.onCallEnded(durationMs);
  };

  room.on(lk.RoomEvent.TrackSubscribed, (...evArgs: unknown[]) => {
    const track = evArgs[0] as LiveKitTrack | undefined;
    if (!track) return;
    if (track.kind === lk.Track.Kind.Audio) {
      const el = track.attach() as HTMLAudioElement;
      el.autoplay = true;
      el.style.display = "none";
      document.body.appendChild(el);
      audioElements.push(el);
    }
  });

  room.on(lk.RoomEvent.Disconnected, () => {
    cleanupAudio(audioElements);
    fireEnded();
  });

  try {
    await room.connect(dispatchBody.url, dispatchBody.token);
  } catch (err) {
    cleanupAudio(audioElements);
    const msg = `LiveKit connection failed: ${err instanceof Error ? err.message : "unknown"}`;
    args.handlers.onError(msg);
    throw err;
  }

  startedAtMs = Date.now();
  args.handlers.onCallStarted();

  // 4. Enable the mic. Non-fatal on failure: caller can still hear the
  //    agent's greeting even if mic permission was denied.
  try {
    await room.localParticipant.setMicrophoneEnabled(true);
  } catch (err) {
    console.warn("[vocadesk] mic enable failed:", err);
  }

  return {
    async stop(): Promise<void> {
      try {
        await room.disconnect();
      } catch {
        /* ignore */
      }
      cleanupAudio(audioElements);
      fireEnded();
    },
  };
}

function cleanupAudio(els: HTMLAudioElement[]): void {
  while (els.length > 0) {
    const el = els.pop();
    if (!el) continue;
    try {
      el.pause();
      el.remove();
    } catch {
      /* ignore */
    }
  }
}
