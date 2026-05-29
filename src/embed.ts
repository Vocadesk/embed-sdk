// One Embed instance per host element. Owns the state machine, the active
// pipecat / LiveKit driver, and the UI render handle. The driver itself
// manages audio capture/playback over WebRTC.

import { DEFAULT_API_URL } from "./config.js";
import { getBrowserId } from "./browser-id.js";
import { StateMachine, type State } from "./state.js";
import { releaseSlot, requestToken, TokenError } from "./api.js";
import { mountShadow, type RenderHandle } from "./ui/render.js";
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
  /** Active pipecat / LiveKit driver for the current call. */
  private driver: { stop(): Promise<void> } | null = null;
  private callStartedAt: number | null = null;
  private timerInterval: number | null = null;
  private resetTimeout: number | null = null;
  private destroyed = false;
  private lastError: { code: ErrorCode; message: string } | null = null;
  /**
   * True between `tokens` succeeding and `release` firing. Pipecat has no
   * guaranteed server-side teardown signal (the agent worker SREMs on
   * call.ended, but a crash bypasses that), so the SDK is the canonical
   * source for freeing the gateway's concurrency slot.
   */
  private slotHeld = false;
  private readonly onPageHide = () => this.releaseSlotIfHeld();

  constructor(deps: EmbedDeps) {
    // Per the W3C spec, attachShadow() only works on a fixed set of elements
    // (div, span, article, section, p, body, etc. — and any custom element).
    // It does NOT work on <button>, <input>, <a>, <img>, and several others.
    // If a customer pasted our snippet using <button>, swap that out for a
    // semantically-equivalent <div> at the same DOM position with the same
    // attributes, so we can attach a shadow root to it.
    this.host = ensureShadowableHost(deps.host);
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

    // sendBeacon-style release on browser close / tab switch away.
    window.addEventListener("pagehide", this.onPageHide);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener("pagehide", this.onPageHide);
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
    // Mic permission first. We don't capture audio ourselves on the pipecat
    // path (LiveKit does that), but pre-prompting here gives the customer
    // an actionable error before we hit the network. The tracks are
    // immediately stopped — LiveKit re-acquires the mic once the room is
    // connected (no second permission prompt, the grant is sticky for the
    // page session).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      for (const t of stream.getTracks()) t.stop();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Mic access failed";
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

    const apiUrl = this.options.apiUrl ?? DEFAULT_API_URL;
    const browserId = getBrowserId();

    let tokenRes;
    try {
      tokenRes = await requestToken({
        apiUrl,
        embedId: this.options.embedId,
        browserId,
      });
    } catch (err) {
      const code: ErrorCode =
        err instanceof TokenError ? (err.code as ErrorCode) : "token_failed";
      const msg = err instanceof Error ? err.message : "Token request failed";
      this.fail(code, msg);
      return;
    }
    this.slotHeld = true;

    // pipecat / LiveKit. Browser POSTs the JWT to dispatchUrl,
    // gets back LiveKit room credentials, and joins the room via
    // livekit-client (loaded on-demand from CDN). LiveKit handles mic
    // capture and remote audio playback over WebRTC.
    try {
      const { startPipecatCall } = await import("./pipecat-driver.js");
      const driver = await startPipecatCall({
        dispatchUrl: tokenRes.dispatchUrl,
        token: tokenRes.token,
        handlers: this.makeDriverHandlers(),
      });
      // If the user hung up or destroyed the embed while we were dispatching,
      // bail out and tear the driver back down — don't leave it dangling.
      if (this.destroyed || this.machine.state === "idle" || this.machine.state === "ended") {
        void driver.stop();
        return;
      }
      this.driver = driver;
    } catch (err) {
      this.fail("ws_failed", err instanceof Error ? err.message : "Pipecat failed");
    }
  }

  /**
   * Driver-handler factory — bridges driver lifecycle callbacks into the
   * embed's state machine.
   */
  private makeDriverHandlers() {
    return {
      onCallStarted: () => {
        if (this.machine.state === "connecting") {
          this.machine.send("ws_open_and_started");
        }
      },
      onCallEnded: () => {
        if (this.machine.state === "active") {
          this.machine.send("hangup"); // active → ending
        }
        if (this.machine.state === "ending") {
          this.machine.send("ws_closed"); // ending → ended
        }
        this.teardownCall("server_end");
      },
      onError: (msg: string) => this.fail("ws_failed", msg),
    };
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
    if (this.driver) {
      try { void this.driver.stop(); } catch { /* ignore */ }
      this.driver = null;
    }
    this.ui.setMeter(0);
    this.releaseSlotIfHeld();
  }

  private releaseSlotIfHeld(): void {
    if (!this.slotHeld) return;
    this.slotHeld = false;
    releaseSlot({
      apiUrl: this.options.apiUrl ?? DEFAULT_API_URL,
      embedId: this.options.embedId,
      browserId: getBrowserId(),
    });
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

/**
 * Returns an element that is guaranteed to support attachShadow().
 *
 * Per the W3C spec the only built-in elements that accept a shadow root are
 * the ones in SHADOW_ALLOWED below — plus any custom element (which has a
 * dash in its tag name). If `host` is anything else (most commonly
 * `<button>`, which our own snippet generator used to emit), swap it for
 * a `<div>` in the same DOM position carrying the same attributes so the
 * shadow attach later succeeds.
 *
 * Spec ref: https://html.spec.whatwg.org/multipage/dom.html#dom-element-attachshadow
 *
 * Tag-name check rather than try/catch because attachShadow has no undo —
 * a successful probe still consumes the element's one allowed shadow root,
 * and mountShadow's subsequent call would then throw.
 */
const SHADOW_ALLOWED = new Set([
  "article", "aside", "blockquote", "body", "div", "footer",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "main", "nav",
  "p", "section", "span",
]);

export function ensureShadowableHost(host: HTMLElement): HTMLElement {
  const tag = host.tagName.toLowerCase();
  if (tag.includes("-") || SHADOW_ALLOWED.has(tag)) {
    return host;
  }
  return swapHostToDiv(host);
}

function swapHostToDiv(host: HTMLElement): HTMLElement {
  const div = document.createElement("div");
  // Copy every attribute except ones meaningless or harmful on a div.
  for (const attr of Array.from(host.attributes)) {
    if (attr.name === "type") continue;     // button/input-only
    if (attr.name === "disabled") continue; // form-control-only
    div.setAttribute(attr.name, attr.value);
  }
  // Preserve the parent so document-level listeners (which find the element
  // via querySelector) keep working after the swap.
  host.parentNode?.replaceChild(div, host);
  return div;
}
