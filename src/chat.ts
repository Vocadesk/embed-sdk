// One ChatEmbed instance per host element. Sibling to embed.ts's Embed —
// same overall shape (state machine + driver + shadow-DOM render handle,
// pagehide slot release) but for text chat instead of voice:
//   - no getUserMedia step, so no requesting_mic/mic_denied states
//   - the driver is a plain WebSocket (chat-driver.ts), not LiveKit/WebRTC
//   - the render handle is a launcher-bubble + panel, not a single button

import { DEFAULT_API_URL } from "./config.js";
import { getBrowserId } from "./browser-id.js";
import { releaseSlot, requestToken, TokenError } from "./api.js";
import { ensureShadowableHost } from "./embed.js";
import { ChatStateMachine, type ChatState } from "./chat-state.js";
import { mountChatShadow, type ChatRenderHandle } from "./ui/render-chat.js";
import { connectChat, type ChatDriver, type ChatDriverHandlers } from "./chat-driver.js";
import type { ChatMountOptions, EmbedHandle, ErrorCode } from "./types.js";

type StartEvent = CustomEvent<Record<string, never>>;
type EndEvent = CustomEvent<{ durationMs: number }>;
type ErrorDetail = { code: ErrorCode; message: string };
type ErrorEvent_ = CustomEvent<ErrorDetail>;

declare global {
  interface HTMLElementEventMap {
    "vocadesk:chat-start": StartEvent;
    "vocadesk:chat-end": EndEvent;
    "vocadesk:chat-error": ErrorEvent_;
  }
}

interface ChatEmbedDeps {
  host: HTMLElement;
  options: ChatMountOptions;
}

export class ChatEmbed implements EmbedHandle {
  private readonly host: HTMLElement;
  private readonly options: ChatMountOptions;
  private readonly machine = new ChatStateMachine();
  private readonly ui: ChatRenderHandle;
  private driver: ChatDriver | null = null;
  private sessionStartedAt: number | null = null;
  private destroyed = false;
  private lastError: { code: ErrorCode; message: string } | null = null;
  /**
   * True between `tokens` succeeding and `release` firing. Same rationale as
   * the voice embed: chat-runtime has no guaranteed server-side teardown
   * signal for every path (a crash bypasses end_call), so the SDK is the
   * canonical source for freeing the gateway's concurrency slot.
   */
  private slotHeld = false;
  private readonly onPageHide = () => this.releaseSlotIfHeld();

  constructor(deps: ChatEmbedDeps) {
    // Same shadow-DOM caveat as the voice embed: attachShadow() only works
    // on a fixed set of elements, swap out anything else (e.g. <button>).
    this.host = ensureShadowableHost(deps.host);
    this.options = deps.options;

    const defaultLabel = this.options.label ?? this.host.textContent?.trim() ?? "";
    // Clear customer-provided text — the shadow root owns rendering now.
    while (this.host.firstChild) this.host.removeChild(this.host.firstChild);

    this.ui = mountChatShadow(
      this.host,
      {
        onActivate: () => void this.onActivate(),
        onClose: () => this.onUserClose(),
        onSend: (text) => this.onUserSend(text),
      },
      defaultLabel.length > 0 ? defaultLabel : "Chat with us",
    );

    this.machine.on((next, prev) => this.onStateChanged(next, prev));

    // sendBeacon-style release on browser close / tab switch away.
    window.addEventListener("pagehide", this.onPageHide);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener("pagehide", this.onPageHide);
    this.teardownSession("destroy");
    this.ui.destroy();
  }

  // --- state-driven side effects -------------------------------------

  private onStateChanged(next: ChatState, _prev: ChatState): void {
    this.ui.setState(next, { errorMessage: this.lastError?.message });
    if (next !== "error") this.lastError = null;

    if (next === "active") {
      this.sessionStartedAt = Date.now();
      this.fireStart();
    }
    if (next === "ended") {
      this.fireEnd();
    }
  }

  // --- user-driven entry points ----------------------------------------

  /** Launcher click from idle, or the restart/retry button from ended/error. */
  private async onActivate(): Promise<void> {
    const state = this.machine.state;
    if (state !== "idle" && state !== "ended" && state !== "error") return;
    const next = this.machine.send("activate");
    if (next !== "connecting") return;
    await this.startSession();
  }

  /** Panel's × — cancels a pending connect, ends an active session, or dismisses ended/error. */
  private onUserClose(): void {
    const state = this.machine.state;
    if (state === "connecting" || state === "active") {
      this.machine.send("stop");
      this.teardownSession("user_close");
    } else if (state === "ended" || state === "error") {
      this.machine.send("reset");
    }
  }

  private onUserSend(text: string): void {
    if (this.machine.state !== "active" || !this.driver) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    this.ui.appendUserMessage(trimmed);
    this.driver.sendMessage(trimmed);
  }

  // --- session lifecycle -------------------------------------------------

  private async startSession(): Promise<void> {
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

    // The visitor may have cancelled (or the embed may have been destroyed)
    // while the token request was in flight — don't open a socket for a
    // session nobody's waiting on.
    if (this.destroyed || this.machine.state !== "connecting") {
      this.releaseSlotIfHeld();
      return;
    }

    try {
      const driver = connectChat({
        dispatchUrl: tokenRes.dispatchUrl,
        token: tokenRes.token,
        handlers: this.makeDriverHandlers(),
      });
      if (this.destroyed || this.machine.state !== "connecting") {
        driver.destroy();
        return;
      }
      this.driver = driver;
    } catch (err) {
      this.fail("ws_failed", err instanceof Error ? err.message : "Chat connection failed");
    }
  }

  /**
   * Driver-handler factory — bridges chat-driver's protocol callbacks into
   * the embed's state machine and the shadow-DOM render handle.
   */
  private makeDriverHandlers(): ChatDriverHandlers {
    return {
      onReady: () => {
        if (this.machine.state === "connecting") {
          this.machine.send("ready");
        }
      },
      onTurnStart: () => {
        if (this.machine.state === "active") this.ui.beginAssistantTurn();
      },
      onDelta: (text: string) => {
        if (this.machine.state === "active") this.ui.appendAssistantDelta(text);
      },
      onTurnEnd: () => {
        if (this.machine.state === "active") this.ui.endAssistantTurn();
      },
      onToolCall: () => {
        if (this.machine.state === "active") this.ui.setToolActive(true);
      },
      onTransientError: (message: string) => {
        // fatal:false — brief inline notice, session stays live.
        this.ui.showNotice(message);
      },
      onFatalError: (message: string) => {
        this.fail("ws_failed", message);
      },
      onEndCall: () => {
        if (this.machine.state === "connecting" || this.machine.state === "active") {
          this.machine.send(this.machine.state === "active" ? "server_end" : "ws_failed");
        }
        this.teardownSession("server_end");
      },
      onClosed: () => {
        // Socket dropped without a prior end_call/fatal-error frame.
        if (this.machine.state === "connecting" || this.machine.state === "active") {
          this.fail("ws_failed", "Chat connection closed unexpectedly");
        }
      },
    };
  }

  private fail(code: ErrorCode, message: string): void {
    this.lastError = { code, message };
    const state = this.machine.state;
    if (state === "connecting" || state === "active") {
      this.machine.send("ws_failed");
    } else {
      // Defensive fallback — shouldn't happen given the call sites above,
      // but force into error rather than leaving the UI stuck.
      this.machine._force("error");
      this.ui.setState("error", { errorMessage: message });
    }
    this.teardownSession("error");
    this.fireError(code, message);
  }

  private teardownSession(_reason: "user_close" | "server_end" | "error" | "destroy"): void {
    if (this.driver) {
      const driver = this.driver;
      this.driver = null;
      try {
        driver.stop();
      } catch {
        /* ignore */
      }
    }
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

  // --- events fired on the host element ------------------------------

  private fireStart(): void {
    this.host.dispatchEvent(new CustomEvent("vocadesk:chat-start", { bubbles: true }));
  }

  private fireEnd(): void {
    const durationMs = this.sessionStartedAt !== null ? Date.now() - this.sessionStartedAt : 0;
    this.sessionStartedAt = null;
    this.host.dispatchEvent(
      new CustomEvent("vocadesk:chat-end", { bubbles: true, detail: { durationMs } }),
    );
  }

  private fireError(code: ErrorCode, message: string): void {
    this.host.dispatchEvent(
      new CustomEvent("vocadesk:chat-error", { bubbles: true, detail: { code, message } }),
    );
  }
}
