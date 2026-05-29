// embed-gateway token endpoint.
//
// On 200 we get a tagged-union response. For pipecat embeds it carries
// { token, dispatchUrl, expiresAt }. The JWT has exp=+60s so the caller
// should hit dispatchUrl immediately and not stash this for later.

import type { TokenResponse } from "./types.js";

/**
 * Best-effort release of the concurrency slot. Used by the SDK after a
 * call ends (Vapi has no server-side end signal) and on `pagehide` so a
 * fresh tab can immediately reconnect without waiting for the gateway's
 * 1-hour safety-net TTL. `keepalive` lets the request survive navigation.
 */
export function releaseSlot(args: {
  apiUrl: string;
  embedId: string;
  browserId: string;
}): void {
  const url = `${args.apiUrl.replace(/\/+$/, "")}/v1/release`;
  const body = JSON.stringify({
    embedId: args.embedId,
    browserId: args.browserId,
  });
  try {
    // fetch keepalive is the modern path; if not supported (older Safari)
    // fall back to sendBeacon which is fire-and-forget by design.
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    })
      .then((res) => {
        if (!res.ok) {
          console.warn(`[vocadesk] slot release failed: HTTP ${res.status} — embedId=${args.embedId}`);
        }
      })
      .catch((err: unknown) => {
        console.warn("[vocadesk] slot release error:", err);
      });
  } catch {
    try {
      navigator.sendBeacon?.(
        url,
        new Blob([body], { type: "application/json" }),
      );
    } catch {
      /* nothing we can do */
    }
  }
}

interface RequestTokenArgs {
  apiUrl: string;
  embedId: string;
  browserId: string;
  turnstileToken?: string | undefined;
  signal?: AbortSignal;
}

export class TokenError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "TokenError";
    this.status = status;
    this.code = code;
  }
}

export async function requestToken(args: RequestTokenArgs): Promise<TokenResponse> {
  const url = `${args.apiUrl.replace(/\/+$/, "")}/v1/tokens`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embedId: args.embedId,
        browserId: args.browserId,
        ...(args.turnstileToken ? { turnstileToken: args.turnstileToken } : {}),
      }),
      signal: args.signal,
    });
  } catch (err) {
    throw new TokenError(0, "network", err instanceof Error ? err.message : "network error");
  }

  if (!res.ok) {
    let code = "token_failed";
    let message = `Token request failed (${res.status})`;
    try {
      const body = (await res.json()) as { code?: string; message?: string };
      if (typeof body?.code === "string") code = body.code;
      if (typeof body?.message === "string") message = body.message;
    } catch {
      /* ignore body parse errors */
    }
    if (res.status === 409) code = "concurrent_call_active";
    throw new TokenError(res.status, code, message);
  }

  const body = (await res.json()) as Record<string, unknown>;
  if (typeof body.token !== "string" || typeof body.dispatchUrl !== "string") {
    throw new TokenError(res.status, "token_failed", "Token response missing fields");
  }
  return {
    provider: "pipecat",
    token: body.token,
    dispatchUrl: body.dispatchUrl,
    expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : "",
  };
}
