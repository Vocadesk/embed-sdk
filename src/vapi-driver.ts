/**
 * Vapi driver. Loaded on-demand (dynamic import) when the token response
 * says `provider: 'vapi'` — keeps the @vapi-ai/web dependency out of the
 * main bundle for v2 embeds, which is the common case.
 *
 * The Vapi web SDK opens its own WebRTC connection to Vapi's servers,
 * captures the mic, plays back agent audio, and emits call-start /
 * call-end / error events. The embed SDK proxies those into the same
 * state machine + UI events as the voice-runtime2 path so the customer
 * snippet behaviour is identical.
 */

export interface VapiDriverHandlers {
  /** Fires when Vapi confirms the call is live. → state machine "active" */
  onCallStarted(): void;
  /** Fires on a clean hangup or remote end. → state machine "ended" */
  onCallEnded(durationMs: number): void;
  /** Vapi/network error during the call. */
  onError(message: string): void;
}

export interface VapiDriver {
  /** End the call (user clicked hang up). Idempotent. */
  stop(): Promise<void>;
}

interface VapiClient {
  start(assistantId: string): Promise<unknown>;
  stop(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

interface VapiCtor {
  new (publicKey: string): VapiClient;
}

/**
 * Dynamically loads @vapi-ai/web, instantiates Vapi with the public key,
 * and starts the assistant call. Returns a handle so the caller can stop.
 */
export async function startVapiCall(args: {
  publicKey: string;
  assistantId: string;
  handlers: VapiDriverHandlers;
}): Promise<VapiDriver> {
  let mod: unknown;
  try {
    mod = await import("@vapi-ai/web");
  } catch (err) {
    args.handlers.onError(
      `Failed to load Vapi SDK: ${err instanceof Error ? err.message : "unknown"}`,
    );
    throw err;
  }

  const Vapi = resolveVapiCtor(mod);
  const vapi = new Vapi(args.publicKey);

  let startedAtMs = 0;

  vapi.on("call-start", () => {
    startedAtMs = Date.now();
    args.handlers.onCallStarted();
  });
  vapi.on("call-end", () => {
    const durationMs = startedAtMs ? Date.now() - startedAtMs : 0;
    args.handlers.onCallEnded(durationMs);
  });
  vapi.on("error", (...payload: unknown[]) => {
    // Vapi's error payload is loosely typed — it can be an Error, a
    // string, or an object like { error, errorMsg, message, type }.
    // Always log the raw payload so the page console has the truth even
    // if our extractor falls back to "Vapi error".
    console.error("[vocadesk] Vapi error event:", ...payload);
    args.handlers.onError(extractVapiErrorMessage(payload));
  });

  try {
    await vapi.start(args.assistantId);
  } catch (err) {
    args.handlers.onError(
      err instanceof Error ? err.message : "Vapi call failed to start",
    );
    throw err;
  }

  return {
    stop: () => vapi.stop().catch(() => undefined),
  };
}

/**
 * Best-effort message extraction from a Vapi error payload.
 * Common shapes observed: Error instances, raw strings, and objects with
 * one of { error, errorMsg, message, msg, msg, type }.
 */
function extractVapiErrorMessage(payload: unknown[]): string {
  const first = payload[0];
  if (first instanceof Error) return first.message || first.name || "Vapi error";
  if (typeof first === "string") return first;
  if (first && typeof first === "object") {
    const o = first as Record<string, unknown>;
    const candidates = [o.errorMsg, o.error, o.message, o.msg, o.type, o.code];
    for (const c of candidates) {
      if (typeof c === "string" && c.length > 0) return c;
      if (c instanceof Error && c.message) return c.message;
    }
    try {
      return JSON.stringify(first);
    } catch {
      /* fall through */
    }
  }
  return "Vapi error";
}

function resolveVapiCtor(mod: unknown): VapiCtor {
  // @vapi-ai/web exposes the constructor either as default export or as
  // the module's default-of-default depending on how the consumer's
  // bundler interops with CJS. Handle both.
  const candidate = mod as { default?: unknown };
  const ctor =
    (candidate.default as { default?: unknown } | undefined)?.default ??
    candidate.default ??
    candidate;
  if (typeof ctor !== "function") {
    throw new Error("Vapi web SDK constructor missing from module export");
  }
  return ctor as VapiCtor;
}
