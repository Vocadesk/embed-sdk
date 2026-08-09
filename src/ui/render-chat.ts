// Shadow DOM renderer for the text-chat embed. Separate DOM shape from
// render.ts's voice button — a launcher bubble that expands into a panel
// containing a scrollable message list, a composer, and a connecting/typing
// indicator. Same `data-state` convention and the same
// --vocadesk-bg/--vocadesk-fg/--vocadesk-accent/--vocadesk-danger/
// --vocadesk-muted custom properties as the voice widget, so operator
// theming carries over with zero extra config.

import stylesCss from "./styles-chat.css?inline";
import type { ChatState } from "../chat-state.js";

const LAUNCHER_ICON_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4.6 3.45A1 1 0 0 1 2 19.65V5a1 1 0 0 1 1-1z"/></svg>';
const SEND_ICON_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 20.6l17.8-8.2a1 1 0 0 0 0-1.8L3.4 2.4a1 1 0 0 0-1.4 1.1L4.5 12l-2.5 8.5a1 1 0 0 0 1.4 1.1z"/></svg>';

export interface ChatRenderHandlers {
  /** Launcher clicked from idle, or the restart/retry button from ended/error. */
  onActivate(): void;
  /** The panel's × — dismiss/cancel/end depending on current state. */
  onClose(): void;
  /** Composer submit while active. */
  onSend(text: string): void;
}

export interface ChatRenderHandle {
  setState(state: ChatState, opts?: { errorMessage?: string }): void;
  /** Render a visitor message bubble (already sent). */
  appendUserMessage(text: string): void;
  /** turn_start — open a new (initially empty) assistant bubble + typing dots. */
  beginAssistantTurn(): void;
  /** delta — append streamed text to the currently open assistant bubble. */
  appendAssistantDelta(text: string): void;
  /** turn_end — finalize the currently open assistant bubble. */
  endAssistantTurn(): void;
  /** tool_call — lightweight "…" indicator; not required to show anything specific. */
  setToolActive(active: boolean): void;
  /** Transient (fatal:false) server error — brief inline notice, auto-dismisses. */
  showNotice(message: string): void;
  destroy(): void;
}

export function mountChatShadow(
  host: HTMLElement,
  handlers: ChatRenderHandlers,
  defaultLabel: string,
): ChatRenderHandle {
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = stylesCss;
  shadow.appendChild(style);

  const launcher = document.createElement("button");
  launcher.className = "launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", defaultLabel || "Open chat");
  launcher.innerHTML = LAUNCHER_ICON_SVG;
  shadow.appendChild(launcher);

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.hidden = true;
  shadow.appendChild(panel);

  const header = document.createElement("div");
  header.className = "header";
  const title = document.createElement("span");
  title.textContent = defaultLabel || "Chat";
  const closeBtn = document.createElement("span");
  closeBtn.className = "close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("role", "button");
  closeBtn.setAttribute("aria-label", "Close chat");
  header.append(title, closeBtn);
  panel.appendChild(header);

  // Connecting-only view (shown before the session has produced any state
  // worth keeping — every new/restarted session starts here).
  const statusView = document.createElement("div");
  statusView.className = "status-panel";
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  const statusLabel = document.createElement("span");
  statusLabel.textContent = "Connecting…";
  statusView.append(spinner, statusLabel);
  panel.appendChild(statusView);

  // Chat view: message list + composer. Shown for active/ended/error so the
  // conversation stays visible after the session ends.
  const chatView = document.createElement("div");
  chatView.style.display = "contents";

  const messagesEl = document.createElement("div");
  messagesEl.className = "messages";
  messagesEl.setAttribute("role", "log");
  messagesEl.setAttribute("aria-live", "polite");
  chatView.appendChild(messagesEl);

  const notice = document.createElement("div");
  notice.className = "notice";
  notice.hidden = true;
  chatView.appendChild(notice);

  const composer = document.createElement("form");
  composer.className = "composer";
  const input = document.createElement("input");
  input.className = "input";
  input.type = "text";
  input.placeholder = "Type a message…";
  input.autocomplete = "off";
  const sendBtn = document.createElement("button");
  sendBtn.className = "send";
  sendBtn.type = "submit";
  sendBtn.setAttribute("aria-label", "Send");
  sendBtn.innerHTML = SEND_ICON_SVG;
  composer.append(input, sendBtn);
  chatView.appendChild(composer);

  panel.appendChild(chatView);

  let currentAssistantBubble: HTMLElement | null = null;
  let typingEl: HTMLElement | null = null;
  let noticeTimeout: number | null = null;

  function scrollToBottom(): void {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping(): void {
    if (typingEl) return;
    typingEl = document.createElement("div");
    typingEl.className = "typing";
    typingEl.innerHTML = "<span></span><span></span><span></span>";
    messagesEl.appendChild(typingEl);
    scrollToBottom();
  }

  function hideTyping(): void {
    if (!typingEl) return;
    typingEl.remove();
    typingEl = null;
  }

  function hideNotice(): void {
    notice.hidden = true;
    if (noticeTimeout !== null) {
      clearTimeout(noticeTimeout);
      noticeTimeout = null;
    }
  }

  const onLauncherClick = (): void => {
    handlers.onActivate();
  };
  launcher.addEventListener("click", onLauncherClick);

  const onCloseClick = (): void => {
    handlers.onClose();
  };
  closeBtn.addEventListener("click", onCloseClick);

  const onComposerSubmit = (ev: Event): void => {
    ev.preventDefault();
    if (input.disabled) return;
    const text = input.value;
    if (!text.trim()) return;
    input.value = "";
    handlers.onSend(text);
  };
  composer.addEventListener("submit", onComposerSubmit);

  function paint(state: ChatState, errorMessage?: string): void {
    // Reflected onto the host element (not just internal nodes) so :host()
    // rules can resize the actual host box from a launcher bubble to the
    // full panel, and so operators/tests have a stable outer hook.
    host.setAttribute("data-state", state);
    panel.hidden = state === "idle";
    launcher.hidden = state !== "idle";
    if (state === "idle") return;

    if (state === "connecting") {
      // Every (re)connect starts a fresh conversation.
      messagesEl.innerHTML = "";
      currentAssistantBubble = null;
      typingEl = null;
      hideNotice();
    }

    statusView.hidden = state !== "connecting";
    chatView.style.display = state === "connecting" ? "none" : "contents";

    const interactive = state === "active";
    input.disabled = !interactive;
    sendBtn.disabled = !interactive;

    if (state === "ended" || state === "error") {
      hideTyping();
      const banner = document.createElement("div");
      banner.className = state === "error" ? "notice" : "typing";
      banner.style.alignSelf = "center";
      banner.textContent =
        state === "error" ? errorMessage || "Something went wrong" : "Chat ended";
      const restart = document.createElement("button");
      restart.className = "restart";
      restart.type = "button";
      restart.textContent = state === "error" ? "Retry" : "Start new chat";
      restart.addEventListener("click", () => handlers.onActivate());
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.alignItems = "center";
      wrap.style.gap = "8px";
      wrap.style.margin = "8px 0";
      wrap.append(banner, restart);
      messagesEl.appendChild(wrap);
      scrollToBottom();
    }
  }

  paint("idle");

  return {
    setState(state: ChatState, opts?: { errorMessage?: string }): void {
      paint(state, opts?.errorMessage);
    },
    appendUserMessage(text: string): void {
      const bubble = document.createElement("div");
      bubble.className = "bubble user";
      bubble.textContent = text;
      messagesEl.appendChild(bubble);
      scrollToBottom();
    },
    beginAssistantTurn(): void {
      currentAssistantBubble = document.createElement("div");
      currentAssistantBubble.className = "bubble assistant";
      currentAssistantBubble.textContent = "";
      messagesEl.appendChild(currentAssistantBubble);
      showTyping();
      scrollToBottom();
    },
    appendAssistantDelta(text: string): void {
      if (!currentAssistantBubble) {
        // Server skipped turn_start (or we missed it) — start one implicitly
        // so the delta isn't dropped on the floor.
        currentAssistantBubble = document.createElement("div");
        currentAssistantBubble.className = "bubble assistant";
        currentAssistantBubble.textContent = "";
        messagesEl.appendChild(currentAssistantBubble);
      }
      hideTyping();
      currentAssistantBubble.textContent += text;
      scrollToBottom();
    },
    endAssistantTurn(): void {
      hideTyping();
      currentAssistantBubble = null;
    },
    setToolActive(active: boolean): void {
      if (active) showTyping();
      else if (!currentAssistantBubble) hideTyping();
    },
    showNotice(message: string): void {
      notice.hidden = false;
      notice.textContent = message;
      if (noticeTimeout !== null) clearTimeout(noticeTimeout);
      noticeTimeout = window.setTimeout(() => {
        noticeTimeout = null;
        notice.hidden = true;
      }, 4000);
    },
    destroy(): void {
      launcher.removeEventListener("click", onLauncherClick);
      closeBtn.removeEventListener("click", onCloseClick);
      composer.removeEventListener("submit", onComposerSubmit);
      if (noticeTimeout !== null) clearTimeout(noticeTimeout);
      shadow.innerHTML = "";
    },
  };
}
