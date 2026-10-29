import { LOGOS } from "./logos";
import type { Hub, Provider } from "./store";

const NS = "http://www.w3.org/2000/svg";
let uidCount = 0;

/** A provider's logo as an inline SVG that takes the text colour, or null when we have no mark for it. */
export function logoSvg(provider: Provider | undefined, size = 14): SVGSVGElement | null {
  const inner = provider && LOGOS[provider];
  if (!inner) return null;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("logo");
  svg.innerHTML = inner;
  return svg;
}

/** The round badge for an agent: its own avatar text if it has one, else the maker's logo, else a letter. */
export function agentAvatar(cls: string, agent: { avatar?: string; name?: string; agentName?: string; color: string }, provider?: Provider): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = `avatar ${cls}`.trim();
  el.style.background = agent.color;
  const custom = agent.avatar?.trim();
  const logo = !custom && provider ? logoSvg(provider, 14) : null;
  if (logo) {
    el.classList.add("has-logo");
    el.append(logo);
  } else el.textContent = custom ? [...custom].slice(0, 2).join("") : [...(agent.name || agent.agentName || "?")][0];
  return el;
}

/**
 * The Focus mark: a square that is solid on the left and dissolves into pixels on the right.
 * Colours come from CSS (--m1, --m2), so it follows the hub.
 */
export function focusMark(size = 64): SVGSVGElement {
  const id = `fm${++uidCount}`;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("focus-mark");
  let cells = "";
  // deterministic scatter: the further right, the fewer and fainter the pixels
  let seed = 5;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 8; r++) {
      const keep = 1 - c * 0.2;
      const roll = rand();
      if (roll > keep) continue;
      const o = (1 - c * 0.2 - rand() * 0.18).toFixed(2);
      cells += `<rect class="px" style="animation-delay:${((c * 8 + r) * 37) % 900}ms" x="${33 + c * 8}" y="${r * 8 + 1}" width="6" height="6" rx="1.4" opacity="${o}"/>`;
    }
  }
  svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--m1)"/><stop offset="1" style="stop-color:var(--m2)"/></linearGradient></defs>
    <g fill="url(#${id})"><path d="M14 0H32V64H14A14 14 0 0 1 0 50V14A14 14 0 0 1 14 0Z"/>${cells}</g>`;
  return svg;
}

/** Tells the whole app which hub is active, so logos and glows can change colour, and plays a short burst. */
export function applyHub(hub: Hub, burst = false): void {
  const root = document.getElementById("app");
  if (!root) return;
  root.dataset.hub = hub;
  if (!burst) return;
  for (const el of root.querySelectorAll<HTMLElement>(".focus-mark, .hello-logo")) {
    el.classList.remove("burst");
    void el.getBoundingClientRect();
    el.classList.add("burst");
  }
}
