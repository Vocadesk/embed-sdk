import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WsClient } from "../../src/ws.js";

// Tiny fake WebSocket — just enough to drive WsClient through its dispatch
// logic without touching the network.
class FakeSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  binaryType = "";
  sent: string[] = [];

  constructor(public url: string) {
    queueMicrotask(() => {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
    });
  }
  send(s: string): void {
    this.sent.push(s);
  }
  close(): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
  emit(raw: string): void {
    this.onmessage?.({ data: raw });
  }
}

describe("WsClient", () => {
  const originalWS = global.WebSocket;

  beforeEach(() => {
    (global as unknown as { WebSocket: typeof FakeSocket }).WebSocket = FakeSocket;
  });
  afterEach(() => {
    (global as unknown as { WebSocket: typeof WebSocket }).WebSocket = originalWS;
  });

  it("sends start frame on open and dispatches started", async () => {
    const handlers = {
      onStarted: vi.fn(),
      onAudio: vi.fn(),
      onTranscript: vi.fn(),
      onAgentEnding: vi.fn(),
      onEndCall: vi.fn(),
      onClear: vi.fn(),
      onTransferCall: vi.fn(),
      onError: vi.fn(),
      onClosed: vi.fn(),
    };
    const client = new WsClient({
      wssUrl: "ws://localhost/embed",
      token: "tok",
      handlers,
    });
    client.connect();

    // Let the microtask queue flush so the fake socket opens.
    await Promise.resolve();
    await Promise.resolve();

    // URL should carry the token as a query param.
    const ws = (client as unknown as { ws: FakeSocket }).ws;
    expect(ws.url).toContain("token=tok");

    // start frame is the first thing sent.
    const first = JSON.parse(ws.sent[0]!) as Record<string, unknown>;
    expect(first.type).toBe("start");

    // Server sends started → handler fires.
    ws.emit(JSON.stringify({ type: "started", callId: "abc" }));
    expect(handlers.onStarted).toHaveBeenCalledWith("abc");
  });

  it("ignores malformed frames", async () => {
    const handlers = {
      onStarted: vi.fn(),
      onAudio: vi.fn(),
      onTranscript: vi.fn(),
      onAgentEnding: vi.fn(),
      onEndCall: vi.fn(),
      onClear: vi.fn(),
      onTransferCall: vi.fn(),
      onError: vi.fn(),
      onClosed: vi.fn(),
    };
    const client = new WsClient({
      wssUrl: "ws://localhost/embed",
      token: "tok",
      handlers,
    });
    client.connect();
    await Promise.resolve();
    await Promise.resolve();
    const ws = (client as unknown as { ws: FakeSocket }).ws;
    ws.emit("not json");
    ws.emit(JSON.stringify({ type: "frobnicate" }));
    expect(handlers.onAudio).not.toHaveBeenCalled();
    expect(handlers.onStarted).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });
});
