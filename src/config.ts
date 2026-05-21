// Default endpoint URLs. Per-mount overrides take precedence.
//
// In production these are the public Vocadesk endpoints. In Vite dev mode the
// VITE_* env vars override them so the SDK can talk to the local mock backend
// without rebuilding.

interface MaybeImportMeta {
  env?: { VITE_API_URL?: string; VITE_WSS_URL?: string };
}

function readEnv(): { api?: string; wss?: string } {
  // Avoid touching import.meta on environments that don't define it.
  try {
    const im = import.meta as unknown as MaybeImportMeta;
    return { api: im.env?.VITE_API_URL, wss: im.env?.VITE_WSS_URL };
  } catch {
    return {};
  }
}

const env = readEnv();

// Default endpoints (production). Both are managed-cert custom domains
// mapped to Cloud Run; the cnames live at GoDaddy. Stable across deploys —
// changing them requires customer snippets to update, so don't.
export const DEFAULT_API_URL = env.api ?? "https://embed.vocadesk.com";
export const DEFAULT_WSS_URL =
  env.wss ?? "wss://voice.vocadesk.com/embed/v1/call";
