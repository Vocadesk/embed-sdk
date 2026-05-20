import { describe, it, expect } from "vitest";
import { parseServerFrame } from "../../src/ws.js";

describe("parseServerFrame", () => {
  it("parses started", () => {
    expect(parseServerFrame('{"type":"started","callId":"abc"}')).toEqual({
      type: "started",
      callId: "abc",
    });
  });

  it("parses audio", () => {
    expect(parseServerFrame('{"type":"audio","data":"AAAA"}')).toEqual({
      type: "audio",
      data: "AAAA",
    });
  });

  it("parses transcript", () => {
    expect(
      parseServerFrame('{"type":"transcript","role":"user","text":"hi","seq":3}'),
    ).toEqual({ type: "transcript", role: "user", text: "hi", seq: 3 });
  });

  it("parses agent_ending / end_call / clear", () => {
    expect(parseServerFrame('{"type":"agent_ending"}')).toEqual({ type: "agent_ending" });
    expect(parseServerFrame('{"type":"end_call"}')).toEqual({ type: "end_call" });
    expect(parseServerFrame('{"type":"clear"}')).toEqual({ type: "clear" });
  });

  it("parses transfer_call", () => {
    expect(parseServerFrame('{"type":"transfer_call","number":"+15551234567"}')).toEqual({
      type: "transfer_call",
      number: "+15551234567",
    });
  });

  it("parses error with message", () => {
    expect(parseServerFrame('{"type":"error","message":"nope"}')).toEqual({
      type: "error",
      message: "nope",
    });
  });

  it("returns null for malformed JSON", () => {
    expect(parseServerFrame("not json")).toBeNull();
  });

  it("returns null for unknown type", () => {
    expect(parseServerFrame('{"type":"frobnicate"}')).toBeNull();
  });

  it("returns null for missing required fields", () => {
    expect(parseServerFrame('{"type":"started"}')).toBeNull();
    expect(parseServerFrame('{"type":"audio"}')).toBeNull();
    expect(parseServerFrame('{"type":"transcript","role":"alien","text":"x","seq":1}')).toBeNull();
  });
});
