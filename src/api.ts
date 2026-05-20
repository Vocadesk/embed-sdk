// embed-gateway token endpoint.
//
// On 200 we get { token, wssUrl, expiresAt }. The JWT has exp=+60s so the
// caller should connect to wssUrl immediately and not stash this for later.

import type { TokenResponse } from "./types.js";

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

  const body = (await res.json()) as Partial<TokenResponse>;
  if (!body.token || !body.wssUrl) {
    throw new TokenError(res.status, "token_failed", "Token response missing fields");
  }
  return {
    token: body.token,
    wssUrl: body.wssUrl,
    expiresAt: body.expiresAt ?? "",
  };
}
