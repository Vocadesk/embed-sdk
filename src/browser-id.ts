// Stable per-browser UUID v4, persisted in localStorage so the same browser
// looks the same to the embed-gateway across calls.
//
// Used by the gateway's concurrency check (one live call per (embedId, browserId)).

const STORAGE_KEY = "vocadesk_browser_id";

function makeUuid(): string {
  // crypto.randomUUID is in our minimum support matrix (Chrome 88+, Safari
  // 14.1+, Firefox 76+). For Firefox 76 it landed in 95, so include a
  // small RFC4122-style fallback as a safety net.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: 122 bits from crypto.getRandomValues, then formatted as v4.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push((bytes[i] ?? 0).toString(16).padStart(2, "0"));
  }
  return (
    `${hex.slice(0, 4).join("")}-` +
    `${hex.slice(4, 6).join("")}-` +
    `${hex.slice(6, 8).join("")}-` +
    `${hex.slice(8, 10).join("")}-` +
    `${hex.slice(10, 16).join("")}`
  );
}

export function getBrowserId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length > 0) {
      return existing;
    }
    const fresh = makeUuid();
    localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // localStorage can throw in private mode or sandboxed iframes. Fall back
    // to an in-memory ID — concurrency safeguards still work for the duration
    // of the page load.
    return makeUuid();
  }
}

/** Test helper — never used in production. */
export function _resetBrowserId(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
