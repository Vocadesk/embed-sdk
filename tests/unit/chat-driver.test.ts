import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { connectChat, parseChatServerFrame } from "../../src/chat-driver.js";
import type { ChatDriverHandlers } from "../../src/chat-driver.js";

/**
 * Minimal WebSocket stand-in. Real jsdom/browser WebSockets actually try to
 * open a network connection, which is exactly what unit tests shouldn't
 * depend on — this gives the test full synchronous control over
 * open/message/close so the auth-handshake-first behavior and per-message
 * dispatch can be asserted deterministically.
 */
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("MockWebSocket: send() while not open");
    }
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  // --- test helpers, not part of the real WebSocket surface -----------

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  simulateRawMessage(data: string): void {
    this.onmessage?.({ data });
  }
}

function makeHandlers(): ChatDriverHandlers & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onReady: vi.fn(),
    onTurnStart: vi.fn(),
    onDelta: vi.fn(),
    onTurnEnd: vi.fn(),
    onToolCall: vi.fn(),
    onTransientError: vi.fn(),
    onFatalError: vi.fn(),
    onEndCall: vi.fn(),
    onClosed: vi.fn(),
  };
}

describe("connectChat", () => {
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    global.WebSocket = originalWebSocket;
  });

  it("sends {type:auth} as the very first message, immediately on open", () => {
    const handlers = makeHandlers();
    connectChat({ dispatchUrl: "wss://chat.example.com/embed/chat", token: "jwt-1", handlers });
    const ws = MockWebSocket.instances[0]!;
    expect(ws.sent).toEqual([]);

    ws.simulateOpen();

    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: "auth", token: "jwt-1" });
  });

  it("dispatches ready with callId", () => {
    const handlers = makeHandlers();
    connectChat({ dispatchUrl: "wss://x", token: "t", handlers });
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();

    ws.simulateMessage({ type: "ready", callId: "call_123" });

    expect(handlers.onReady).toHaveBeenCalledWith("call_123");
  });

  it("dispatches turn_start, delta, and turn_end in order", () => {
    const handlers = makeHandlers();
    connectChat({ dispatchUrl: "wss://x", token: "t", handlers });
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();

    ws.simulateMessage({ type: "turn_start" });
    ws.simulateMessage({ type: "delta", text: "Hel" });
    ws.simulateMessage({ type: "delta", text: "lo" });
    ws.simulateMessage({ type: "turn_end" });

    expect(handlers.onTurnStart).toHaveBeenCalledTimes(1);
    expect(handlers.onDelta).toHaveBeenNthCalledWith(1, "Hel");
    expect(handlers.onDelta).toHaveBeenNthCalledWith(2, "lo");
    expect(handlers.onTurnEnd).toHaveBeenCalledTimes(1);
  });

  it("dispatches tool_call with the tool name", () => {
    const handlers = makeHandlers();
    connectChat({ dispatchUrl: "wss://x", token: "t", handlers });
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();

    ws.simulateMessage({ type: "tool_call", name: "check_menu" });

    expect(handlers.onToolCall).toHaveBeenCalledWith("check_menu");
  });

  it("treats fatal:false errors as transient — no teardown, socket stays open", () => {
    const handlers = makeHandlers();
    connectChat({ dispatchUrl: "wss://x", token: "t", handlers });
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();

    ws.simulateMessage({ type: "error", message: "rate limited", fatal: false });

    expect(handlers.onTransientError).toHaveBeenCalledWith("rate limited");
    expect(handlers.onFatalError).not.toHaveBeenCalled();
    expect(handlers.onClosed).not.toHaveBeenCalled();
    expect(ws.readyState).toBe(MockWebSocket.OPEN);
  });

  it("tears down the session on fatal:true errors", () => {
    const handlers = makeHandlers();
    connectChat({ dispatchUrl: "wss://x", token: "t", handlers });
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();

    ws.simulateMessage({ type: "error", message: "internal error", fatal: true });

    expect(handlers.onFatalError).toHaveBeenCalledWith("internal error");
    expect(handlers.onTransientError).not.toHaveBeenCalled();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    // The close triggered by the driver itself shouldn't also fire onClosed.
    expect(handlers.onClosed).not.toHaveBeenCalled();
  });

  it("closes the socket and fires onEndCall on end_call", () => {
    const handlers = makeHandlers();
    connectChat({ dispatchUrl: "wss://x", token: "t", handlers });
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();

    ws.simulateMessage({ type: "end_call" });

    expect(handlers.onEndCall).toHaveBeenCalledTimes(1);
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    expect(handlers.onClosed).not.toHaveBeenCalled();
  });

  it("fires onClosed for an unexpected close with no prior end_call/error", () => {
    const handlers = makeHandlers();
    connectChat({ dispatchUrl: "wss://x", token: "t", handlers });
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();

    ws.close(); // simulate the network/browser dropping the connection

    expect(handlers.onClosed).toHaveBeenCalledTimes(1);
    expect(handlers.onEndCall).not.toHaveBeenCalled();
    expect(handlers.onFatalError).not.toHaveBeenCalled();
  });

  it("ignores malformed and unknown-type frames", () => {
    const handlers = makeHandlers();
    connectChat({ dispatchUrl: "wss://x", token: "t", handlers });
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();

    ws.simulateRawMessage("not json");
    ws.simulateMessage({ type: "some_future_type", foo: "bar" });
    ws.simulateMessage({ type: "delta" }); // missing required "text"

    expect(handlers.onDelta).not.toHaveBeenCalled();
    expect(handlers.onReady).not.toHaveBeenCalled();
  });

  it("sendMessage sends {type:message,text} only while open", () => {
    const handlers = makeHandlers();
    const driver = connectChat({ dispatchUrl: "wss://x", token: "t", handlers });
    const ws = MockWebSocket.instances[0]!;

    driver.sendMessage("too early");
    expect(ws.sent).toEqual([]);

    ws.simulateOpen(); // sends auth
    driver.sendMessage("hello agent");

    expect(ws.sent).toHaveLength(2);
    expect(JSON.parse(ws.sent[1]!)).toEqual({ type: "message", text: "hello agent" });
  });

  it("stop() sends {type:stop} then closes; is idempotent", () => {
    const handlers = makeHandlers();
    const driver = connectChat({ dispatchUrl: "wss://x", token: "t", handlers });
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();

    driver.stop();

    expect(JSON.parse(ws.sent[ws.sent.length - 1]!)).toEqual({ type: "stop" });
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    expect(handlers.onClosed).not.toHaveBeenCalled();

    // Second call must not throw or re-send.
    expect(() => driver.stop()).not.toThrow();
  });

  it("destroy() closes without sending a stop message", () => {
    const handlers = makeHandlers();
    const driver = connectChat({ dispatchUrl: "wss://x", token: "t", handlers });
    const ws = MockWebSocket.instances[0]!;
    ws.simulateOpen();

    driver.destroy();

    expect(ws.sent.some((s) => JSON.parse(s).type === "stop")).toBe(false);
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    expect(handlers.onClosed).not.toHaveBeenCalled();
  });

  it("reports a synchronous WebSocket construction failure via onFatalError, async", async () => {
    class ThrowingWebSocket {
      constructor() {
        throw new Error("bad url");
      }
    }
    vi.stubGlobal("WebSocket", ThrowingWebSocket as unknown as typeof WebSocket);

    const handlers = makeHandlers();
    const driver = connectChat({ dispatchUrl: "not-a-url", token: "t", handlers });

    expect(handlers.onFatalError).not.toHaveBeenCalled();
    expect(() => driver.sendMessage("x")).not.toThrow();
    expect(() => driver.stop()).not.toThrow();
    expect(() => driver.destroy()).not.toThrow();

    await Promise.resolve();
    await Promise.resolve();

    expect(handlers.onFatalError).toHaveBeenCalledWith("bad url");
  });
});

describe("parseChatServerFrame", () => {
  it("returns null for invalid JSON", () => {
    expect(parseChatServerFrame("{not json")).toBeNull();
  });

  it("returns null for an unknown type", () => {
    expect(parseChatServerFrame(JSON.stringify({ type: "mystery" }))).toBeNull();
  });

  it("parses every known server frame shape", () => {
    expect(parseChatServerFrame(JSON.stringify({ type: "ready", callId: "c1" }))).toEqual({
      type: "ready",
      callId: "c1",
    });
    expect(parseChatServerFrame(JSON.stringify({ type: "turn_start" }))).toEqual({
      type: "turn_start",
    });
    expect(parseChatServerFrame(JSON.stringify({ type: "delta", text: "hi" }))).toEqual({
      type: "delta",
      text: "hi",
    });
    expect(parseChatServerFrame(JSON.stringify({ type: "turn_end" }))).toEqual({
      type: "turn_end",
    });
    expect(parseChatServerFrame(JSON.stringify({ type: "tool_call", name: "lookup" }))).toEqual({
      type: "tool_call",
      name: "lookup",
    });
    expect(
      parseChatServerFrame(JSON.stringify({ type: "error", message: "oops", fatal: true })),
    ).toEqual({ type: "error", message: "oops", fatal: true });
    expect(parseChatServerFrame(JSON.stringify({ type: "end_call" }))).toEqual({
      type: "end_call",
    });
  });

  it("defaults fatal to false when omitted", () => {
    expect(parseChatServerFrame(JSON.stringify({ type: "error", message: "m" }))).toEqual({
      type: "error",
      message: "m",
      fatal: false,
    });
  });
});
