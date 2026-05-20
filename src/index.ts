// Vocadesk embed SDK entry point.
//
// Auto-binds any element with [data-vocadesk-embed] on DOMContentLoaded and
// exposes window.Vocadesk for programmatic use.

import { Embed } from "./embed.js";
import { VERSION } from "./version.js";
import type { EmbedHandle, MountOptions } from "./types.js";

const ATTR = "data-vocadesk-embed";
const BOUND_MARKER = "__vocadeskBound";

interface HostElement extends HTMLElement {
  [BOUND_MARKER]?: Embed;
}

function bindElement(el: HTMLElement, overrideOptions?: Partial<MountOptions>): Embed | null {
  const host = el as HostElement;
  if (host[BOUND_MARKER]) return host[BOUND_MARKER] ?? null;
  const embedId = overrideOptions?.embedId ?? el.getAttribute(ATTR) ?? "";
  if (!embedId) return null;
  const opts: MountOptions = {
    embedId,
    ...(overrideOptions?.label !== undefined ? { label: overrideOptions.label } : {}),
    ...(overrideOptions?.apiUrl !== undefined ? { apiUrl: overrideOptions.apiUrl } : {}),
    ...(overrideOptions?.wssUrl !== undefined ? { wssUrl: overrideOptions.wssUrl } : {}),
  };
  const embed = new Embed({ host: el, options: opts });
  host[BOUND_MARKER] = embed;
  return embed;
}

function resolveElement(target: string | HTMLElement): HTMLElement | null {
  if (typeof target === "string") {
    return document.querySelector<HTMLElement>(target);
  }
  return target instanceof HTMLElement ? target : null;
}

function mount(target: string | HTMLElement, options: MountOptions): EmbedHandle {
  const el = resolveElement(target);
  if (!el) throw new Error(`Vocadesk.mount: element not found for ${String(target)}`);
  const embed = bindElement(el, options);
  if (!embed) throw new Error("Vocadesk.mount: failed to bind (missing embedId)");
  return {
    destroy: () => {
      embed.destroy();
      delete (el as HostElement)[BOUND_MARKER];
    },
  };
}

function autoBind(): void {
  const nodes = document.querySelectorAll<HTMLElement>(`[${ATTR}]`);
  nodes.forEach((el) => {
    bindElement(el);
  });
}

interface VocadeskApi {
  mount(target: string | HTMLElement, options: MountOptions): EmbedHandle;
  version: string;
}

const api: VocadeskApi = { mount, version: VERSION };

// Expose without clobbering anything the customer might have set already.
const w = window as unknown as { Vocadesk?: VocadeskApi };
if (!w.Vocadesk) {
  w.Vocadesk = api;
} else {
  Object.assign(w.Vocadesk, api);
}

// Safe to load with `defer` or after DOMContentLoaded; covers both cases.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", autoBind, { once: true });
} else {
  autoBind();
}

// Re-export for tests + library consumers (the IIFE bundle exposes
// window.Vocadesk; this is for vitest only).
export { Embed, VERSION, mount };
export type { MountOptions, EmbedHandle };
