// Vocadesk embed SDK entry point.
//
// Auto-binds any element with [data-vocadesk-embed] (voice) or
// [data-vocadesk-chat] (text chat) on DOMContentLoaded and exposes
// window.Vocadesk for programmatic use.

import { Embed } from "./embed.js";
import { ChatEmbed } from "./chat.js";
import { VERSION } from "./version.js";
import type { ChatMountOptions, EmbedHandle, MountOptions } from "./types.js";

const ATTR = "data-vocadesk-embed";
const CHAT_ATTR = "data-vocadesk-chat";
const BOUND_MARKER = "__vocadeskBound";
const CHAT_BOUND_MARKER = "__vocadeskChatBound";

interface HostElement extends HTMLElement {
  [BOUND_MARKER]?: Embed;
  [CHAT_BOUND_MARKER]?: ChatEmbed;
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

function bindChatElement(
  el: HTMLElement,
  overrideOptions?: Partial<ChatMountOptions>,
): ChatEmbed | null {
  const host = el as HostElement;
  if (host[CHAT_BOUND_MARKER]) return host[CHAT_BOUND_MARKER] ?? null;
  const embedId = overrideOptions?.embedId ?? el.getAttribute(CHAT_ATTR) ?? "";
  if (!embedId) return null;
  const opts: ChatMountOptions = {
    embedId,
    ...(overrideOptions?.label !== undefined ? { label: overrideOptions.label } : {}),
    ...(overrideOptions?.apiUrl !== undefined ? { apiUrl: overrideOptions.apiUrl } : {}),
  };
  const chatEmbed = new ChatEmbed({ host: el, options: opts });
  host[CHAT_BOUND_MARKER] = chatEmbed;
  return chatEmbed;
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

function mountChat(target: string | HTMLElement, options: ChatMountOptions): EmbedHandle {
  const el = resolveElement(target);
  if (!el) throw new Error(`Vocadesk.mountChat: element not found for ${String(target)}`);
  const chatEmbed = bindChatElement(el, options);
  if (!chatEmbed) throw new Error("Vocadesk.mountChat: failed to bind (missing embedId)");
  return {
    destroy: () => {
      chatEmbed.destroy();
      delete (el as HostElement)[CHAT_BOUND_MARKER];
    },
  };
}

function autoBind(): void {
  const nodes = document.querySelectorAll<HTMLElement>(`[${ATTR}]`);
  nodes.forEach((el) => {
    bindElement(el);
  });
  const chatNodes = document.querySelectorAll<HTMLElement>(`[${CHAT_ATTR}]`);
  chatNodes.forEach((el) => {
    bindChatElement(el);
  });
}

interface VocadeskApi {
  mount(target: string | HTMLElement, options: MountOptions): EmbedHandle;
  mountChat(target: string | HTMLElement, options: ChatMountOptions): EmbedHandle;
  version: string;
}

const api: VocadeskApi = { mount, mountChat, version: VERSION };

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
export { Embed, ChatEmbed, VERSION, mount, mountChat };
export type { MountOptions, ChatMountOptions, EmbedHandle };
