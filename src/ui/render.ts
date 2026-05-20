// Shadow DOM renderer. State-driven — call setState() and the relevant view
// pops in. Theme via CSS custom properties on the host element.

import stylesCss from "./styles.css?inline";
import type { State } from "../state.js";
import { createMeterBars } from "./meter-bars.js";

const MIC_ICON_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11z"/></svg>';

export interface RenderHandlers {
  /** Click anywhere inside the embed UI (except the explicit close button). */
  onActivate(): void;
  /** Click the small × in the active state — user explicitly hanging up. */
  onHangup(): void;
}

export interface RenderHandle {
  setState(state: State, opts?: { errorMessage?: string }): void;
  setLabel(label: string): void;
  setMeter(level: number): void;
  setTimer(seconds: number): void;
  destroy(): void;
}

interface InternalNodes {
  btn: HTMLButtonElement;
  iconHost: HTMLSpanElement;
  labelHost: HTMLSpanElement;
  meter: ReturnType<typeof createMeterBars>;
  closeBtn: HTMLSpanElement;
  timer: HTMLSpanElement;
}

export function mountShadow(host: HTMLElement, handlers: RenderHandlers, defaultLabel: string): RenderHandle {
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = stylesCss;
  shadow.appendChild(style);

  const btn = document.createElement("button");
  btn.className = "btn";
  btn.type = "button";
  btn.setAttribute("data-state", "idle");
  btn.setAttribute("aria-label", "Start voice call");
  shadow.appendChild(btn);

  const iconHost = document.createElement("span");
  iconHost.className = "icon";
  btn.appendChild(iconHost);

  const labelHost = document.createElement("span");
  labelHost.className = "label";
  btn.appendChild(labelHost);

  const timer = document.createElement("span");
  timer.className = "timer";
  timer.style.display = "none";
  btn.appendChild(timer);

  const meter = createMeterBars();
  meter.root.style.display = "none";
  btn.appendChild(meter.root);

  const closeBtn = document.createElement("span");
  closeBtn.className = "close";
  closeBtn.textContent = "×";
  closeBtn.setAttribute("role", "button");
  closeBtn.setAttribute("aria-label", "End call");
  closeBtn.style.display = "none";
  btn.appendChild(closeBtn);

  const nodes: InternalNodes = { btn, iconHost, labelHost, meter, closeBtn, timer };

  let currentLabel = defaultLabel;
  let currentState: State = "idle";

  const onClick = (ev: Event): void => {
    ev.stopPropagation();
    if (ev.target === closeBtn || (ev.composedPath && ev.composedPath().indexOf(closeBtn) !== -1)) {
      handlers.onHangup();
      return;
    }
    handlers.onActivate();
  };
  btn.addEventListener("click", onClick);

  function paint(state: State, errorMessage?: string): void {
    currentState = state;
    btn.setAttribute("data-state", state);
    // Clear transient children every render — keep things simple.
    iconHost.innerHTML = "";
    timer.style.display = "none";
    meter.root.style.display = "none";
    closeBtn.style.display = "none";
    btn.disabled = false;

    switch (state) {
      case "idle":
        iconHost.innerHTML = MIC_ICON_SVG;
        labelHost.textContent = currentLabel;
        break;
      case "requesting_mic":
        iconHost.appendChild(spinner());
        labelHost.textContent = "Allow microphone…";
        btn.disabled = true;
        break;
      case "mic_denied":
        iconHost.appendChild(warn());
        labelHost.textContent = "Mic blocked — Retry";
        break;
      case "connecting":
        iconHost.appendChild(spinner());
        labelHost.textContent = "Connecting…";
        btn.disabled = true;
        break;
      case "active":
        iconHost.appendChild(redDot());
        labelHost.textContent = "";
        timer.style.display = "";
        meter.root.style.display = "";
        closeBtn.style.display = "";
        break;
      case "ending":
        iconHost.appendChild(spinner());
        labelHost.textContent = "Ending…";
        btn.disabled = true;
        break;
      case "ended":
        iconHost.appendChild(warn());
        labelHost.textContent = "Call ended";
        btn.disabled = true;
        break;
      case "error":
        iconHost.appendChild(warn());
        labelHost.textContent = errorMessage ? errorMessage : "Something went wrong — Retry";
        break;
    }
  }

  paint("idle");

  return {
    setState(state: State, opts?: { errorMessage?: string }): void {
      paint(state, opts?.errorMessage);
    },
    setLabel(label: string): void {
      currentLabel = label;
      if (currentState === "idle") {
        labelHost.textContent = label;
      }
    },
    setMeter(level: number): void {
      nodes.meter.update(level);
    },
    setTimer(seconds: number): void {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      timer.textContent = `${m}:${s < 10 ? "0" : ""}${s}`;
    },
    destroy(): void {
      btn.removeEventListener("click", onClick);
      shadow.innerHTML = "";
    },
  };
}

function spinner(): HTMLElement {
  const el = document.createElement("span");
  el.className = "spinner";
  return el;
}

function redDot(): HTMLElement {
  const el = document.createElement("span");
  el.className = "dot";
  return el;
}

function warn(): HTMLElement {
  const el = document.createElement("span");
  el.className = "warn";
  el.textContent = "⚠";
  return el;
}
