import { describe, it, expect } from "vitest";
import { ChatStateMachine } from "../../src/chat-state.js";

describe("ChatStateMachine", () => {
  it("starts in idle", () => {
    const m = new ChatStateMachine();
    expect(m.state).toBe("idle");
  });

  it("walks the happy path: idle -> connecting -> active -> ended", () => {
    const m = new ChatStateMachine();
    expect(m.send("activate")).toBe("connecting");
    expect(m.send("ready")).toBe("active");
    expect(m.send("stop")).toBe("ended");
  });

  it("server_end also ends an active session", () => {
    const m = new ChatStateMachine();
    m.send("activate");
    m.send("ready");
    expect(m.send("server_end")).toBe("ended");
  });

  it("ws_failed from connecting or active goes to error", () => {
    const m = new ChatStateMachine();
    m.send("activate");
    expect(m.send("ws_failed")).toBe("error");

    const m2 = new ChatStateMachine();
    m2.send("activate");
    m2.send("ready");
    expect(m2.send("ws_failed")).toBe("error");
  });

  it("stop while still connecting cancels back to idle (no session existed)", () => {
    const m = new ChatStateMachine();
    m.send("activate");
    expect(m.send("stop")).toBe("idle");
  });

  it("ended/error can restart directly (activate) or dismiss (reset)", () => {
    const m = new ChatStateMachine();
    m.send("activate");
    m.send("ready");
    m.send("stop"); // -> ended
    expect(m.send("reset")).toBe("idle");

    const m2 = new ChatStateMachine();
    m2.send("activate");
    m2.send("ready");
    m2.send("stop"); // -> ended
    expect(m2.send("activate")).toBe("connecting");

    const m3 = new ChatStateMachine();
    m3.send("activate");
    m3.send("ws_failed"); // -> error
    expect(m3.send("activate")).toBe("connecting");
  });

  it("rejects invalid transitions and stays put", () => {
    const m = new ChatStateMachine();
    expect(m.send("ready")).toBeNull();
    expect(m.state).toBe("idle");
    m.send("activate");
    expect(m.send("server_end")).toBeNull();
    expect(m.state).toBe("connecting");
  });

  it("notifies listeners with next + prev", () => {
    const m = new ChatStateMachine();
    const events: Array<[string, string]> = [];
    m.on((next, prev) => events.push([prev, next]));
    m.send("activate");
    m.send("ready");
    expect(events).toEqual([
      ["idle", "connecting"],
      ["connecting", "active"],
    ]);
  });

  it("listener can unsubscribe", () => {
    const m = new ChatStateMachine();
    let count = 0;
    const off = m.on(() => (count += 1));
    m.send("activate");
    off();
    m.send("ready");
    expect(count).toBe(1);
  });

  it("_force sets state directly for defensive fallbacks", () => {
    const m = new ChatStateMachine();
    m._force("error");
    expect(m.state).toBe("error");
  });
});
