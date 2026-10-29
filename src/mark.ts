const NS = "http://www.w3.org/2000/svg";

/**
 * The Focus mark: a square cut by a thick, pixelated diagonal. One side is empty (only the faint
 * grid shows), the other is solid, and the cut itself is three pixels thick, fading from one side
 * to the other. Every cell stays inside the square; the gaps between cells are the "divisions".
 */
export function focusMark(size = 64): SVGSVGElement {
  const N = 12;
  const gap = 0.16;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${N} ${N}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("shape-rendering", "geometricPrecision");
  svg.classList.add("focus-mark");
  let cells = "";
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // t is the distance from the anti-diagonal, in cells: negative = empty side, positive = solid side
      const t = x + y - (N - 1);
      let o: number;
      let cls = "";
      if (t <= -2) o = 0.1;
      else if (t === -1) (o = 0.38), (cls = "px");
      else if (t === 0) (o = 0.68), (cls = "px");
      else if (t === 1) (o = 0.9), (cls = "px");
      else o = 1;
      // the wave runs down the diagonal: each cell starts a little after the one above-right of it
      const delay = cls ? `style="--o:${o};animation-delay:${(N - 1 - x) * 85 + (t + 1) * 40}ms" ` : "";
      cells += `<rect ${cls ? `class="${cls}" ` : ""}${delay}x="${(x + gap / 2).toFixed(3)}" y="${(y + gap / 2).toFixed(3)}" width="${(1 - gap).toFixed(3)}" height="${(1 - gap).toFixed(3)}" rx="0.14" opacity="${o}"/>`;
    }
  }
  svg.innerHTML = `<g style="fill:var(--logo-fg, currentColor)">${cells}</g>`;
  return svg;
}

