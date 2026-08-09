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

/**
 * Options for `Vocadesk.mountChat` / `[data-vocadesk-chat]` text-chat embeds.
 * Mirrors `MountOptions` minus the voice-only `wssUrl` override — chat
 * always gets its WebSocket endpoint from the token response's
 * `dispatchUrl` (a `wss://` URL for chat embeds).
 */
export interface ChatMountOptions {
  /** Embed ID (the value of [data-vocadesk-chat]). */
  embedId: string;
  /** Override the customer-facing label on the launcher bubble. */
  label?: string;
  /** Override the token endpoint base URL (dev/staging only). */
  apiUrl?: string;
}

export interface EmbedHandle {
  destroy(): void;
}

/**
 * JSON body returned by POST /v1/tokens. The SDK POSTs the JWT to
 * dispatchUrl. For voice ("pipecat") embeds that's an https:// dispatch
 * endpoint that hands back LiveKit room credentials; for chat embeds it's
 * a wss:// URL the SDK connects to directly.
 */
export interface TokenResponse {
  provider: "pipecat" | "chat";
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
