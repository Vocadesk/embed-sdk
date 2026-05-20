import { describe, it, expect } from "vitest";
import { StateMachine } from "../../src/state.js";

describe("StateMachine", () => {
  it("starts in idle", () => {
    const m = new StateMachine();
    expect(m.state).toBe("idle");
  });

  it("walks the happy path", () => {
    const m = new StateMachine();
    expect(m.send("click")).toBe("requesting_mic");
    expect(m.send("mic_granted")).toBe("connecting");
    expect(m.send("ws_open_and_started")).toBe("active");
    expect(m.send("hangup")).toBe("ending");
    expect(m.send("ws_closed")).toBe("ended");
    expect(m.send("reset")).toBe("idle");
  });

  it("handles mic denial + retry", () => {
    const m = new StateMachine();
    m.send("click");
    expect(m.send("mic_failed")).toBe("mic_denied");
    expect(m.send("retry")).toBe("requesting_mic");
  });

  it("handles ws failure + retry", () => {
    const m = new StateMachine();
    m.send("click");
    m.send("mic_granted");
    expect(m.send("ws_failed")).toBe("error");
    expect(m.send("retry")).toBe("idle");
  });

  it("rejects invalid transitions and stays put", () => {
    const m = new StateMachine();
    expect(m.send("ws_open_and_started")).toBeNull();
    expect(m.state).toBe("idle");
    m.send("click");
    expect(m.send("hangup")).toBeNull();
    expect(m.state).toBe("requesting_mic");
  });

  it("notifies listeners with next + prev", () => {
    const m = new StateMachine();
    const events: Array<[string, string]> = [];
    m.on((next, prev) => events.push([prev, next]));
    m.send("click");
    m.send("mic_granted");
    expect(events).toEqual([
      ["idle", "requesting_mic"],
      ["requesting_mic", "connecting"],
    ]);
  });

  it("listener can unsubscribe", () => {
    const m = new StateMachine();
    let count = 0;
    const off = m.on(() => (count += 1));
    m.send("click");
    off();
    m.send("mic_granted");
    expect(count).toBe(1);
  });
});
