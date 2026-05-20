// Auto-injected at build time via Vite's `define`.

declare const process: { env?: Record<string, string | undefined> } | undefined;

export const VERSION: string = (() => {
  try {
    const v = typeof process !== "undefined" && process?.env?.SDK_VERSION;
    if (typeof v === "string" && v.length > 0) return v;
  } catch {
    /* ignore */
  }
  return "0.0.0-dev";
})();
