// Chat WebSocket driver. Plain native WebSocket — no third-party library, no
// CDN import. This is the whole point of chat not needing LiveKit/WebRTC:
// text frames over a single long-lived socket are simple enough that a
// dependency would be pure overhead.
//
// Wire protocol (fixed by the embed-gateway / chat-runtime contract — do not
// deviate without updating the backend in the same change):
//
//   client → server:
//     {"type":"auth","token":"<jwt>"}   — sent immediately on open, first message
//     {"type":"message","text":"..."}   — one submitted chat message
//     {"type":"stop"}                   — visitor ends the session
//
//   server → client:
//     {"type":"ready","callId":"..."}                     — auth ok, session live
//     {"type":"turn_start"}                                — assistant beginning to respond
//     {"type":"delta","text":"..."}                        — streamed text chunk
//     {"type":"turn_end"}                                  — assistant response complete
//     {"type":"tool_call","name":"..."}                    — optional, tool executing server-side
//     {"type":"error","message":"...","fatal":bool}        — fatal:false is transient
//     {"type":"end_call"}                                  — session over, close the socket

export type ChatServerFrame =
  | { type: "ready"; callId: string }
  | { type: "turn_start" }
  | { type: "delta"; text: string }
  | { type: "turn_end" }
  | { type: "tool_call"; name: string }
  | { type: "error"; message: string; fatal: boolean }
  | { type: "end_call" };

/** Validate + classify a server frame; returns null on malformed/unknown input. */
export function parseChatServerFrame(raw: string): ChatServerFrame | null {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object") return null;
  switch (msg["type"]) {
    case "ready":
      return typeof msg["callId"] === "string"
        ? { type: "ready", callId: msg["callId"] }
        : null;
    case "turn_start":
      return { type: "turn_start" };
    case "delta":
      return typeof msg["text"] === "string" ? { type: "delta", text: msg["text"] } : null;
    case "turn_end":
      return { type: "turn_end" };
    case "tool_call":
      return typeof msg["name"] === "string" ? { type: "tool_call", name: msg["name"] } : null;
    case "error":
      return typeof msg["message"] === "string"
        ? { type: "error", message: msg["message"], fatal: msg["fatal"] === true }
        : null;
    case "end_call":
      return { type: "end_call" };
    default:
      return null;
  }
}

export interface ChatDriverHandlers {
  /** Auth succeeded, session live — analogous to the voice widget's "call started". */
  onReady(callId: string): void;
  /** Assistant beginning to respond. */
  onTurnStart(): void;
  /** Streamed text chunk — append to the in-progress assistant bubble. */
  onDelta(text: string): void;
  /** Assistant's response is complete. */
  onTurnEnd(): void;
  /** A tool is executing server-side. Optional to render. */
  onToolCall(name: string): void;
  /** fatal:false — transient (e.g. rate-limited). Don't tear down the session. */
  onTransientError(message: string): void;
  /** fatal:true — tear down the session and show an error state. */
  onFatalError(message: string): void;
  /** Session ended (goodbye / timeout / post-fatal-error cleanup). */
  onEndCall(): void;
  /** Socket closed without a prior end_call/fatal error (network drop, etc). */
  onClosed(): void;
}

export interface ChatDriver {
  /** Send one visitor chat message. No-op if the socket isn't open. */
  sendMessage(text: string): void;
  /** Graceful stop — sends {"type":"stop"} (if open) then closes. Idempotent. */
  stop(): void;
  /** Hard teardown, no message sent — for abandoning a not-yet-adopted driver. Idempotent. */
  destroy(): void;
}

/**
 * Open the chat WebSocket and wire the protocol above into `handlers`.
 * Returns synchronously — construction failures are reported async via
 * `onFatalError` so callers can attach/observe uniformly regardless of
 * whether the failure is sync (bad URL) or async (network/auth failure).
 */
export function connectChat(args: {
  dispatchUrl: string;
  token: string;
  handlers: ChatDriverHandlers;
}): ChatDriver {
  const { dispatchUrl, token, handlers } = args;
  let ws: WebSocket | null = null;
  // True once we've already reported a terminal outcome (end_call / fatal
  // error) or initiated our own close — suppresses a redundant onClosed.
  let settled = false;

  const sendJson = (payload: Record<string, unknown>): void => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* ignore — the close handler will fire shortly */
    }
  };

  const closeSocket = (): void => {
    settled = true;
    if (!ws) return;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };

  try {
    ws = new WebSocket(dispatchUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "WebSocket construction failed";
    queueMicrotask(() => handlers.onFatalError(msg));
    return {
      sendMessage: () => undefined,
      stop: () => undefined,
      destroy: () => undefined,
    };
  }

  ws.onopen = () => {
    // MUST be the very first message sent, immediately after open.
    sendJson({ type: "auth", token });
  };

  ws.onmessage = (ev: MessageEvent) => {
    if (typeof ev.data !== "string") return;
    const frame = parseChatServerFrame(ev.data);
    if (!frame) return;
    switch (frame.type) {
      case "ready":
        handlers.onReady(frame.callId);
        return;
      case "turn_start":
        handlers.onTurnStart();
        return;
      case "delta":
        handlers.onDelta(frame.text);
        return;
      case "turn_end":
        handlers.onTurnEnd();
        return;
      case "tool_call":
        handlers.onToolCall(frame.name);
        return;
      case "error":
        if (frame.fatal) {
          closeSocket();
          handlers.onFatalError(frame.message);
        } else {
          handlers.onTransientError(frame.message);
        }
        return;
      case "end_call":
        closeSocket();
        handlers.onEndCall();
        return;
    }
  };

  ws.onerror = () => {
    // Browsers hide the actual failure reason on the error event for
    // security; the close event that follows carries onClosed.
  };

  ws.onclose = () => {
    if (!settled) {
      settled = true;
      handlers.onClosed();
    }
  };

  return {
    sendMessage(text: string): void {
      sendJson({ type: "message", text });
    },
    stop(): void {
      if (!ws || settled) {
        settled = true;
        return;
      }
      if (ws.readyState === WebSocket.OPEN) {
        sendJson({ type: "stop" });
      }
      closeSocket();
    },
    destroy(): void {
      if (!ws || settled) {
        settled = true;
        return;
      }
      closeSocket();
    },
  };
}
