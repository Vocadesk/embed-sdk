// One Embed instance per host element. Owns the state machine, audio
// pipelines, WebSocket, and UI render handle.

import { DEFAULT_API_URL, DEFAULT_WSS_URL } from "./config.js";
import { getBrowserId } from "./browser-id.js";
import { StateMachine, type State } from "./state.js";
import { requestToken, TokenError } from "./api.js";
import { WsClient } from "./ws.js";
import { mountShadow, type RenderHandle } from "./ui/render.js";
import { startCapture, type CaptureSession, isAudioSupported } from "./audio/capture.js";
import { startPlayback, type PlaybackSession } from "./audio/playback.js";
import { rmsToBars } from "./audio/meter.js";
import type { EmbedHandle, ErrorCode, MountOptions } from "./types.js";

type StartEvent = CustomEvent<Record<string, never>>;
type EndEvent = CustomEvent<{ durationMs: number }>;
type ErrorDetail = { code: ErrorCode; message: string };
type ErrorEvent_ = CustomEvent<ErrorDetail>;

declare global {
  interface HTMLElementEventMap {
    "vocadesk:start": StartEvent;
    "vocadesk:end": EndEvent;
    "vocadesk:error": ErrorEvent_;
  }
}

interface EmbedDeps {
  host: HTMLElement;
  options: MountOptions;
}

export class Embed implements EmbedHandle {
  private readonly host: HTMLElement;
  private readonly options: MountOptions;
  private readonly machine = new StateMachine();
  private readonly ui: RenderHandle;
  private capture: CaptureSession | null = null;
  private playback: PlaybackSession | null = null;
  private ws: WsClient | null = null;
  private callStartedAt: number | null = null;
  private timerInterval: number | null = null;
  private resetTimeout: number | null = null;
  private destroyed = false;
  private lastError: { code: ErrorCode; message: string } | null = null;
  private agentEnding = false;

  constructor(deps: EmbedDeps) {
    this.host = deps.host;
    this.options = deps.options;

    const defaultLabel =
      this.options.label ??
      this.host.textContent?.trim() ??
      "";
    // Clear customer-provided text — the shadow root owns rendering now.
    while (this.host.firstChild) this.host.removeChild(this.host.firstChild);

    this.ui = mountShadow(
      this.host,
      {
        onActivate: () => void this.onActivate(),
        onHangup: () => this.onUserHangup(),
      },
      defaultLabel.length > 0 ? defaultLabel : "Start call",
    );

    this.machine.on((next, prev) => this.onStateChanged(next, prev));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.teardownCall("destroy");
    this.ui.destroy();
  }

  // --- state-driven side effects -------------------------------------

  private onStateChanged(next: State, _prev: State): void {
    this.ui.setState(next, { errorMessage: this.lastError?.message });
    if (next !== "error") this.lastError = null;

    if (next === "active") {
      this.callStartedAt = Date.now();
      this.startTimer();
      this.fireStart();
    }
    if (next === "ended") {
      this.fireEnd();
      // Auto-reset to idle after 1.5 s so the user sees the confirmation.
      this.scheduleReset(1500);
    }
    if (next === "error" || next === "mic_denied") {
      // Stay in these states until the user clicks again (handled below).
    }
  }

  // --- user-driven entry points --------------------------------------

  private async onActivate(): Promise<void> {
    const state = this.machine.state;
    if (state === "idle") {
      this.machine.send("click");
      await this.startCall();
    } else if (state === "mic_denied") {
      this.machine.send("retry");
      await this.startCall();
    } else if (state === "error") {
      this.machine.send("retry"); // → idle
      // Don't immediately start — user has to click again. (Matches docs:
      // "error → idle (after retry click)".)
    } else if (state === "ended") {
      // Allow a quick second call without waiting for the auto-reset.
      this.cancelReset();
      this.machine.send("reset");
    }
  }

  private onUserHangup(): void {
    if (this.machine.state !== "active") return;
    this.machine.send("hangup");
    this.teardownCall("user_hangup");
  }

  // --- call lifecycle --------------------------------------------------

  private async startCall(): Promise<void> {
    if (!isAudioSupported()) {
      this.fail("mic_unavailable", "Audio not supported in this browser");
      return;
    }

    // Mic permission first. Failing here gives a clear error before we try
    // anything network-related.
    try {
      this.capture = await startCapture({
        onAudio: (b64) => {
          if (this.ws?.isOpen && !this.agentEnding) this.ws.sendAudio(b64);
        },
        onMeter: (rms) => {
          if (this.machine.state === "active") this.ui.setMeter(rmsToBars(rms));
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Mic access failed";
      // Distinguish denial vs other failures by name (NotAllowedError vs
      // NotFoundError / NotReadableError).
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        this.machine.send("mic_failed");
        this.fireError("mic_denied", msg || "Microphone permission denied");
      } else {
        this.machine.send("mic_failed");
        this.fireError("mic_unavailable", msg);
      }
      return;
    }

    this.machine.send("mic_granted");

    // Token + WS handshake.
    try {
      this.playback = await startPlayback();
    } catch (err) {
      this.fail("mic_unavailable", err instanceof Error ? err.message : "Playback init failed");
      return;
    }

    const apiUrl = this.options.apiUrl ?? DEFAULT_API_URL;
    const browserId = getBrowserId();

    let token: string;
    let wssUrl: string;
    try {
      const tokenRes = await requestToken({
        apiUrl,
        embedId: this.options.embedId,
        browserId,
      });
      token = tokenRes.token;
      wssUrl = tokenRes.wssUrl || this.options.wssUrl || DEFAULT_WSS_URL;
    } catch (err) {
      const code: ErrorCode =
        err instanceof TokenError ? (err.code as ErrorCode) : "token_failed";
      const msg = err instanceof Error ? err.message : "Token request failed";
      this.fail(code, msg);
      return;
    }

    this.ws = new WsClient({
      wssUrl,
      token,
      handlers: {
        onStarted: () => {
          if (this.machine.state === "connecting") {
            this.machine.send("ws_open_and_started");
          }
        },
        onAudio: (b64) => this.playback?.enqueue(b64),
        onTranscript: () => {
          // Reserved for a future captions UI. We intentionally do not surface
          // transcripts in the embed today.
        },
        onAgentEnding: () => {
          // Agent has decided to hang up; stop sending mic audio so we don't
          // accidentally re-trigger the model mid-goodbye.
          this.agentEnding = true;
        },
        onEndCall: () => {
          if (this.machine.state === "active") {
            this.machine.send("hangup");
          }
          this.teardownCall("server_end");
        },
        onClear: () => this.playback?.clear(),
        onTransferCall: (_number: string) => {
          // Embed does not place outbound PSTN calls. Treat as a hard hangup
          // so the UI doesn't sit there forever; operator can configure their
          // own routing if they want transfer behaviour.
          if (this.machine.state === "active") this.machine.send("hangup");
          this.teardownCall("server_end");
        },
        onError: (message) => {
          this.fail("ws_failed", message);
        },
        onClosed: () => {
          if (this.machine.state === "ending") {
            this.machine.send("ws_closed");
          } else if (this.machine.state === "active" || this.machine.state === "connecting") {
            // Unexpected close.
            this.fail("ws_failed", "Connection closed unexpectedly");
          }
        },
      },
    });
    this.ws.connect();
  }

  private fail(code: ErrorCode, message: string): void {
    this.lastError = { code, message };
    // Force into error state regardless of current state (covers mid-call
    // network drops as well as token/WS handshake failures).
    if (this.machine.state === "connecting") {
      this.machine.send("ws_failed");
    } else if (this.machine.state === "active") {
      this.machine.send("hangup");
      this.machine.send("ws_closed");
      // ended → schedule reset → error replaces it
      this.cancelReset();
      this.machine._force("error");
      this.ui.setState("error", { errorMessage: message });
    } else {
      this.machine._force("error");
      this.ui.setState("error", { errorMessage: message });
    }
    this.teardownCall("error");
    this.fireError(code, message);
  }

  private teardownCall(_reason: string): void {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    if (this.capture) {
      try { this.capture.stop(); } catch { /* ignore */ }
      this.capture = null;
    }
    if (this.playback) {
      try { this.playback.stop(); } catch { /* ignore */ }
      this.playback = null;
    }
    this.agentEnding = false;
    this.ui.setMeter(0);
  }

  private startTimer(): void {
    if (this.timerInterval !== null) return;
    this.ui.setTimer(0);
    this.timerInterval = window.setInterval(() => {
      if (this.callStartedAt === null) return;
      const elapsed = Math.floor((Date.now() - this.callStartedAt) / 1000);
      this.ui.setTimer(elapsed);
    }, 1000);
  }

  private scheduleReset(ms: number): void {
    this.cancelReset();
    this.resetTimeout = window.setTimeout(() => {
      this.resetTimeout = null;
      if (this.machine.state === "ended") this.machine.send("reset");
    }, ms);
  }

  private cancelReset(): void {
    if (this.resetTimeout !== null) {
      clearTimeout(this.resetTimeout);
      this.resetTimeout = null;
    }
  }

  // --- events fired on the host element ------------------------------

  private fireStart(): void {
    this.host.dispatchEvent(new CustomEvent("vocadesk:start", { bubbles: true }));
  }

  private fireEnd(): void {
    const durationMs = this.callStartedAt !== null ? Date.now() - this.callStartedAt : 0;
    this.callStartedAt = null;
    this.host.dispatchEvent(
      new CustomEvent("vocadesk:end", { bubbles: true, detail: { durationMs } }),
    );
  }

  private fireError(code: ErrorCode, message: string): void {
    this.host.dispatchEvent(
      new CustomEvent("vocadesk:error", { bubbles: true, detail: { code, message } }),
    );
  }
}
