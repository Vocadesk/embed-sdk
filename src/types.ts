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
 * JSON body returned by POST /v1/tokens. The SDK POSTs the JWT to
 * dispatchUrl, gets back LiveKit room URL + token, and joins the room
 * via livekit-client.
 */
export interface TokenResponse {
  provider: "pipecat";
  token: string;
  dispatchUrl: string;
  expiresAt: string;
}

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
