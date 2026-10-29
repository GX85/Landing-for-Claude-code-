/**
 * The Focus agent: a plain square with Pac-Man ghost eyes. No animation, by design.
 * The square takes any colour; the eyes stay white with blue pupils.
 */
export function agentMascot(color = "#ffffff", size = 40): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.classList.add("mascot");
  // a light square needs a thin outline round the whites of the eyes, or they vanish into it
  const light = isLight(color);
  const rim = light ? ' stroke="rgba(0,0,0,.3)" stroke-width=".3"' : "";
  // every corner is a one-pixel step on a 20x20 grid: the square, and each eye
  const eye = (x: number) => `<path d="M${x + 1} 5h3v1h1v3h-1v1h-3v-1h-1v-3h1z" fill="#fff"${rim}/>`;
  const pupil = (x: number) => `<path d="M${x} 6h2v3h-2zM${x - 1} 7h1v1h-1z" fill="#2f4ff0"/>`;
  svg.innerHTML =
    `<path d="M1 0h18v1h1v18h-1v1h-18v-1h-1v-18h1z" fill="${color}"${light ? ' stroke="rgba(0,0,0,.12)" stroke-width=".3"' : ""}/>` +
    eye(3) + eye(12) + pupil(3) + pupil(12);
  return svg;
}

function isLight(color: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 170;
}
