// 6-bar mic level renderer. Toggles .on classes only; CSS handles colour + height.

import { BAR_COUNT } from "../audio/meter.js";

export function createMeterBars(): { root: HTMLElement; update(level: number): void } {
  const root = document.createElement("span");
  root.className = "meter";
  const bars: HTMLSpanElement[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const s = document.createElement("span");
    root.appendChild(s);
    bars.push(s);
  }
  let last = -1;
  return {
    root,
    update(level: number): void {
      if (level === last) return;
      last = level;
      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];
        if (!bar) continue;
        if (i < level) bar.classList.add("on");
        else bar.classList.remove("on");
      }
    },
  };
}
