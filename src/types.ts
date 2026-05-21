// Shared types used across modules.

export interface MountOptions {
  /** Embed ID (the value of [data-vocadesk-embed]). */
  embedId: string;
  /** Override the customer-facing label for the idle state. */
  label?: string;
  /** Override the token endpoint base URL (dev/staging only). */
  apiUrl?: string;
  /** Override the WSS URL (rare — token response normally wins). */
  wssUrl?: string;
}

export interface EmbedHandle {
  destroy(): void;
}

/**
 * JSON body returned by POST /v1/tokens. Tagged union by `provider`:
 *  - 'voice-runtime2': v2 embeds. SDK opens a WSS handshake to wssUrl
 *    with the JWT in the query string.
 *  - 'vapi': legacy embeds. SDK loads @vapi-ai/web and calls
 *    `new Vapi(vapiPublicKey).start(vapiAssistantId)`.
 */
export type TokenResponse =
  | {
      provider: "voice-runtime2";
      token: string;
      wssUrl: string;
      expiresAt: string;
    }
  | {
      provider: "vapi";
      vapiPublicKey: string;
      vapiAssistantId: string;
    };

export type ErrorCode =
  | "mic_denied"
  | "mic_unavailable"
  | "token_failed"
  | "ws_failed"
  | "concurrent_call_active"
  | "network"
  | "unknown";

export interface EmbedError {
  code: ErrorCode;
  message: string;
}
