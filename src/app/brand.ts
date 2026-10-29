import { LOGOS } from "./logos";
import { agentMascot } from "../mascot";
import { focusMark } from "../mark";
export { focusMark } from "../mark";
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
export function agentAvatar(cls: string, agent: { avatar?: string; name?: string; agentName?: string; color: string; mascot?: string; focus?: boolean }, provider?: Provider): HTMLSpanElement {
  const el = document.createElement("span");
  if (agent.mascot) {
    el.className = `avatar mascot-avatar ${cls}`.trim();
    el.append(agentMascot(agent.mascot, cls === "xs" ? 18 : cls === "sm" ? 20 : 28));
    return el;
  }
  if (agent.focus) {
    el.className = `avatar mascot-avatar ${cls}`.trim();
    el.append(focusMark(cls === "xs" ? 18 : cls === "sm" ? 20 : 28));
    return el;
  }
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
