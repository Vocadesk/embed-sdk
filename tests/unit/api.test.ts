import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { releaseSlot, requestToken, TokenError } from "../../src/api.js";

describe("requestToken", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts JSON and returns token response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: "jwt", wssUrl: "wss://x/y", expiresAt: "2099-01-01T00:00:00Z" }),
    });
    const res = await requestToken({
      apiUrl: "https://api.example.com",
      embedId: "emb_1",
      browserId: "br_1",
    });
    expect(res.provider).toBe("voice-runtime2");
    if (res.provider !== "voice-runtime2") throw new Error("unreachable");
    expect(res.token).toBe("jwt");
    expect(res.wssUrl).toBe("wss://x/y");
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe("https://api.example.com/v1/tokens");
    const body = JSON.parse(call[1].body) as Record<string, unknown>;
    expect(body).toEqual({ embedId: "emb_1", browserId: "br_1" });
  });

  it("returns vapi-shape response when provider='vapi'", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        provider: "vapi",
        vapiPublicKey: "pk_live_abc",
        vapiAssistantId: "asst_xyz",
      }),
    });
    const res = await requestToken({
      apiUrl: "https://api.example.com",
      embedId: "emb_legacy",
      browserId: "br_1",
    });
    expect(res.provider).toBe("vapi");
    if (res.provider !== "vapi") throw new Error("unreachable");
    expect(res.vapiPublicKey).toBe("pk_live_abc");
    expect(res.vapiAssistantId).toBe("asst_xyz");
  });

  it("includes turnstile token when provided", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: "t", wssUrl: "wss://x", expiresAt: "" }),
    });
    await requestToken({
      apiUrl: "https://api.example.com",
      embedId: "emb_1",
      browserId: "br_1",
      turnstileToken: "ts_xyz",
    });
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(call[1].body) as Record<string, unknown>;
    expect(body.turnstileToken).toBe("ts_xyz");
  });

  it("strips trailing slashes from apiUrl", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: "t", wssUrl: "wss://x", expiresAt: "" }),
    });
    await requestToken({
      apiUrl: "https://api.example.com///",
      embedId: "emb_1",
      browserId: "br_1",
    });
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe("https://api.example.com/v1/tokens");
  });

  it("throws TokenError with concurrent_call_active on 409", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ code: "concurrent_call_active", message: "busy" }),
    });
    try {
      await requestToken({ apiUrl: "https://x", embedId: "e", browserId: "b" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TokenError);
      expect((err as TokenError).code).toBe("concurrent_call_active");
      expect((err as TokenError).status).toBe(409);
    }
  });

  it("throws on network failure", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));
    await expect(
      requestToken({ apiUrl: "https://x", embedId: "e", browserId: "b" }),
    ).rejects.toMatchObject({ code: "network" });
  });

  it("throws when response is missing token", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    await expect(
      requestToken({ apiUrl: "https://x", embedId: "e", browserId: "b" }),
    ).rejects.toMatchObject({ code: "token_failed" });
  });
});

describe("releaseSlot", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("POSTs to /v1/release with keepalive and the embedId+browserId", () => {
    releaseSlot({
      apiUrl: "https://api.example.com",
      embedId: "emb_release_1",
      browserId: "br_release_1",
    });
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe("https://api.example.com/v1/release");
    expect(call[1].method).toBe("POST");
    expect(call[1].keepalive).toBe(true);
    expect(JSON.parse(call[1].body)).toEqual({
      embedId: "emb_release_1",
      browserId: "br_release_1",
    });
  });

  it("does not throw when fetch rejects (best-effort fire-and-forget)", () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("offline"));
    expect(() =>
      releaseSlot({ apiUrl: "https://x", embedId: "e", browserId: "b" }),
    ).not.toThrow();
  });
});
