// Default endpoint URLs. Per-mount overrides take precedence.
//
// In production these are the public Vocadesk endpoints. Build-time VITE_*
// env vars override them (e.g. the staging build bakes the staging URLs).
//
// IMPORTANT: Vite only statically inlines `import.meta.env.VITE_*` when it
// appears as that literal expression. Reading it via an alias/cast (e.g.
// `(import.meta as X).env.VITE_API_URL`) is NOT replaced at build time, so the
// override silently has no effect in the bundled output. Keep the direct form.

declare global {
  interface ImportMetaEnv {
    readonly VITE_API_URL?: string;
    readonly VITE_WSS_URL?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

// Default endpoints (production). Custom domains mapped to Cloud Run; the
// CNAMEs live at GoDaddy. Stable across deploys — changing them requires
// customer snippets to update, so don't.
export const DEFAULT_API_URL =
  import.meta.env.VITE_API_URL ?? "https://embed.vocadesk.com";
export const DEFAULT_WSS_URL =
  import.meta.env.VITE_WSS_URL ?? "wss://voice.vocadesk.com/embed/v1/call";
