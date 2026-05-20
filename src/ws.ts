// WSS client + frame protocol.
//
// Mirrors voice-runtime2's /direct/test-call protocol (the embed endpoint
// /embed/v1/call speaks the same wire format — only auth differs):
//
//   client → server:
//     {"type":"start", "agentId":"<ignored — JWT controls this>", "promptOverride":null}
//     {"type":"audio", "data":"<base64 PCM16 24kHz mono>"}
//     {"type":"barge_in"}
//     {"type":"stop"}
//
//   server → client:
//     {"type":"started", "callId":"..."}
//     {"type":"audio",   "data":"<base64 PCM16 24kHz>"}
//     {"type":"transcript", "role":"user|assistant", "text":"...", "seq":N}
//     {"type":"agent_ending"}
//     {"type":"end_call"}
//     {"type":"clear"}
//     {"type":"error", "message":"..."}

export type ServerFrame =
  | { type: "started"; callId: string }
  | { type: "audio"; data: string }
  | { type: "transcript"; role: "user" | "assistant"; text: string; seq: number }
  | { type: "agent_ending" }
  | { type: "end_call" }
  | { type: "transfer_call"; number: string }
  | { type: "clear" }
  | { type: "error"; message: string };

export interface WsClientHandlers {
  onStarted(callId: string): void;
  onAudio(b64: string): void;
  onTranscript(role: "user" | "assistant", text: string, seq: number): void;
  onAgentEnding(): void;
  onEndCall(): void;
  onClear(): void;
  onTransferCall(number: string): void;
  onError(message: string): void;
  onClosed(): void;
}

/** Validate + classify a server frame; returns null on malformed input. */
export function parseServerFrame(raw: string): ServerFrame | null {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object") return null;
  const t = msg["type"];
  switch (t) {
    case "started":
      return typeof msg["callId"] === "string"
        ? { type: "started", callId: msg["callId"] }
        : null;
    case "audio":
      return typeof msg["data"] === "string"
        ? { type: "audio", data: msg["data"] }
        : null;
    case "transcript": {
      const role = msg["role"];
      const text = msg["text"];
      const seq = msg["seq"];
      if (
        (role === "user" || role === "assistant") &&
        typeof text === "string" &&
        typeof seq === "number"
      ) {
        return { type: "transcript", role, text, seq };
      }
      return null;
    }
    case "agent_ending":
      return { type: "agent_ending" };
    case "end_call":
      return { type: "end_call" };
    case "clear":
      return { type: "clear" };
    case "transfer_call":
      return typeof msg["number"] === "string"
        ? { type: "transfer_call", number: msg["number"] }
        : null;
    case "error":
      return typeof msg["message"] === "string"
        ? { type: "error", message: msg["message"] }
        : { type: "error", message: "unknown" };
    default:
      return null;
  }
}

export interface WsClientOptions {
  wssUrl: string;
  token: string;
  handlers: WsClientHandlers;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private readonly handlers: WsClientHandlers;
  private opened = false;
  private closed = false;

  constructor(private readonly options: WsClientOptions) {
    this.handlers = options.handlers;
  }

  connect(): void {
    const url = new URL(this.options.wssUrl);
    url.searchParams.set("token", this.options.token);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url.toString());
    } catch (err) {
      this.handlers.onError(err instanceof Error ? err.message : "ws construct failed");
      return;
    }
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      this.opened = true;
      // Server controls agent from JWT — `agentId` is ignored but kept for
      // protocol compatibility with /direct/test-call.
      this.sendJson({ type: "start", agentId: "", promptOverride: null });
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      const frame = parseServerFrame(ev.data);
      if (!frame) return;
      this.dispatch(frame);
    };
    ws.onerror = () => {
      // The browser hides actual WS error reasons for security. We surface a
      // generic message; the close event that follows usually carries more.
      if (!this.opened) {
        this.handlers.onError("ws connection failed");
      }
    };
    ws.onclose = () => {
      this.closed = true;
      this.handlers.onClosed();
    };
  }

  private dispatch(frame: ServerFrame): void {
    switch (frame.type) {
      case "started":
        this.handlers.onStarted(frame.callId);
        return;
      case "audio":
        this.handlers.onAudio(frame.data);
        return;
      case "transcript":
        this.handlers.onTranscript(frame.role, frame.text, frame.seq);
        return;
      case "agent_ending":
        this.handlers.onAgentEnding();
        return;
      case "end_call":
        this.handlers.onEndCall();
        return;
      case "clear":
        this.handlers.onClear();
        return;
      case "transfer_call":
        this.handlers.onTransferCall(frame.number);
        return;
      case "error":
        this.handlers.onError(frame.message);
        return;
    }
  }

  sendAudio(b64: string): void {
    this.sendJson({ type: "audio", data: b64 });
  }

  sendBargeIn(): void {
    this.sendJson({ type: "barge_in" });
  }

  sendStop(): void {
    this.sendJson({ type: "stop" });
  }

  close(): void {
    if (this.closed) return;
    const ws = this.ws;
    if (!ws) return;
    try {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendStop();
      }
      ws.close();
    } catch {
      /* ignore */
    }
  }

  get isOpen(): boolean {
    return this.opened && !this.closed;
  }

  private sendJson(payload: Record<string, unknown>): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* ignore — the close handler will fire shortly */
    }
  }
}
