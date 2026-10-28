import { activateSections, deactivateSections, initSections } from "./sections";

const DURATION = 2100;
const REC_COLLAPSE_AT = 4900;
const VIDEO_FALLBACK_DURATION = 4.25;

const EASE_SLIT = "cubic-bezier(.5,0,.3,1)";
const EASE_CIRCLE = "cubic-bezier(.45,0,.3,1)";
const EASE_PILL = "cubic-bezier(.4,0,.2,1)";
const EASE_UI = "cubic-bezier(.2,.8,.2,1)";

const root = document.getElementById("landing")!;
const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;

const paper = $<HTMLElement>(".paper");
const lines = $<SVGSVGElement>(".lines");
const nav = $<HTMLElement>(".nav");
const word = $<HTMLElement>(".word");
const pill = $<HTMLElement>(".pill");
const hair = $<HTMLElement>(".hair");
const video = $<HTMLVideoElement>(".scene");
const icons = root.querySelectorAll<HTMLElement>(".icon");
const speaker = $<HTMLButtonElement>(".icon-speaker");
const foot = $<HTMLElement>(".foot");
const rule = $<HTMLElement>(".rule");
const cta = $<HTMLAnchorElement>(".cta");

const phoneQuery = matchMedia("(max-width: 720px)");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const recording = new URLSearchParams(location.search).get("rec") === "1";

/* ---------- background lines ---------- */

function drawLines(): void {
  // small deterministic PRNG so the strokes are identical on every load
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const ns = "http://www.w3.org/2000/svg";
  const count = 15;

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const x = -520 + t * 1180 + (rand() - 0.5) * 60;
    const lift = (rand() - 0.5) * 120;
    const d = [
      `M ${x} ${1090 + lift * 0.3}`,
      `C ${x + 230} ${880 + lift} ${x + 120} ${560 + lift} ${x + 430} ${430 + lift * 0.6}`,
      `S ${x + 720} ${120 + lift * 0.4} ${x + 1080} ${-90}`,
    ].join(" ");

    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    path.setAttribute("stroke-width", (1.2 + rand() * 2.7).toFixed(2));
    path.setAttribute("opacity", (0.55 + rand() * 0.3).toFixed(2));
    lines.appendChild(path);
  }
}

/* ---------- the reveal timeline ---------- */

type Track = [target: Element, keyframes: Keyframe[], easing?: string];

/** Holds a value at `from` until offset `a`, eases to `to` by offset `b`, then holds. */
function span(prop: string, from: string, to: string, a: number, b: number, easing: string): Keyframe[] {
  return [
    { offset: 0, [prop]: from },
    { offset: a, [prop]: from, easing },
    { offset: b, [prop]: to },
    { offset: 1, [prop]: to },
  ];
}

function tracks(): Track[] {
  const phone = phoneQuery.matches;
  const shared: Track[] = [
    [hair, [{ offset: 0, opacity: 1 }, { offset: 0.14, opacity: 1, easing: "ease-out" }, { offset: 0.3, opacity: 0 }, { offset: 1, opacity: 0 }]],
    [paper, span("opacity", "0", "1", 0.45, 0.78, "ease-in-out")],
    [nav, span("transform", "translateY(-140%)", "translateY(0)", 0.5, 0.86, EASE_UI)],
    [foot, span("transform", "translateY(160%)", "translateY(0)", 0.52, 0.9, EASE_UI)],
    [rule, span("transform", "scaleX(0)", "scaleX(1)", 0.4, 0.95, EASE_UI)],
    ...[...icons].map((icon): Track => [icon, span("opacity", "0", "0.85", 0.8, 1, "ease-out")]),
  ];

  if (phone) {
    // the pill opens vertically: hairline across, then 1.5px → 10% → 55% → 100% of its height
    const h = (innerWidth - 40) / 1.85;
    return [
      ...shared,
      [pill, [
        { offset: 0, height: "1.5px" },
        { offset: 0.14, height: "1.5px", easing: EASE_SLIT },
        { offset: 0.3, height: `${h * 0.1}px`, easing: EASE_CIRCLE },
        { offset: 0.58, height: `${h * 0.55}px`, easing: EASE_PILL },
        { offset: 1, height: `${h}px` },
      ]],
      [pill, [
        { offset: 0, clipPath: "inset(0 50% round 999px)", easing: EASE_PILL },
        { offset: 0.14, clipPath: "inset(0 0% round 999px)" },
        { offset: 1, clipPath: "inset(0 0% round 999px)" },
      ]],
      [word, [
        { offset: 0, gap: "0.03em" },
        { offset: 0.14, gap: "0.03em", easing: EASE_CIRCLE },
        { offset: 0.58, gap: "0.06em", easing: EASE_PILL },
        { offset: 1, gap: "0.1em" },
      ]],
    ];
  }

  return [
    ...shared,
    [pill, [
      { offset: 0, width: "0.012em" },
      { offset: 0.14, width: "0.012em", easing: EASE_SLIT },
      { offset: 0.3, width: "0.16em", easing: EASE_CIRCLE },
      { offset: 0.58, width: "1.81em", easing: EASE_PILL },
      { offset: 1, width: "3.62em" },
    ]],
    [pill, [
      { offset: 0, clipPath: "inset(50% 0 round 999px)", easing: EASE_PILL },
      { offset: 0.14, clipPath: "inset(0% 0 round 999px)" },
      { offset: 1, clipPath: "inset(0% 0 round 999px)" },
    ]],
    [word, [
      { offset: 0, gap: "0.026em" },
      { offset: 0.14, gap: "0.026em", easing: EASE_CIRCLE },
      { offset: 0.58, gap: "0.05em", easing: EASE_PILL },
      { offset: 1, gap: "0.085em" },
    ]],
  ];
}

let anims: Animation[] = [];
let generation = 0;
let busy = false;

/** Builds the paused timeline at `time` ms; the CSS final state lives underneath it. */
function build(time: number): Animation[] {
  clear();
  anims = tracks().map(([el, kf]) => {
    const a = el.animate(kf, { duration: DURATION, fill: "both" });
    a.pause();
    a.currentTime = time;
    return a;
  });
  return anims;
}

function clear(): void {
  anims.forEach((a) => a.cancel());
  anims = [];
}

const settle = (list: Animation[]) => Promise.all(list.map((a) => a.finished)).then(() => undefined, () => undefined);

async function reveal(): Promise<void> {
  const gen = generation;
  const list = anims.length ? anims : build(0);
  list.forEach((a) => {
    a.playbackRate = 1;
    a.play();
  });
  await settle(list);
  if (gen === generation) clear();
}

async function collapse(): Promise<void> {
  const list = anims.length ? anims : build(DURATION);
  list.forEach((a) => {
    a.playbackRate = -1;
    a.play();
  });
  await settle(list);
}

let onEnter: (path: string) => void = () => undefined;

/** "Let's Focus": the reveal plays in reverse down to the hairline, then the app opens. */
async function enterApp(path: string): Promise<void> {
  if (busy) return;
  busy = true;
  // the collapse only makes sense while the hero is on screen
  if (!reducedMotion && scrollY < innerHeight * 0.3) await collapse();
  busy = false;
  onEnter(path);
}

/* ---------- interaction ---------- */

speaker.addEventListener("click", () => {
  // the clip is silent; this only toggles the sound waves
  speaker.setAttribute("aria-pressed", String(speaker.getAttribute("aria-pressed") !== "true"));
});

const plainClick = (e: MouseEvent) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);

cta.addEventListener("click", (e) => {
  if (!plainClick(e)) return;
  e.preventDefault();
  void enterApp(new URL(cta.href).pathname);
});

// nav links into the app switch views in place
root.addEventListener("click", (e) => {
  const link = (e.target as Element).closest<HTMLAnchorElement>("a[data-route]");
  if (!link || link === cta || !plainClick(e)) return;
  e.preventDefault();
  onEnter(new URL(link.href).pathname);
});

let lastSize = `${innerWidth}x${innerHeight}`;
addEventListener("resize", () => {
  const size = `${innerWidth}x${innerHeight}`;
  if (size === lastSize) return;
  lastSize = size;
  if (!anims.length) return;
  // finish whatever is running and fall back to the CSS final state at the new size
  generation++;
  anims.forEach((a) => a.finish());
  clear();
  busy = false;
});

/* ---------- recording mode ---------- */

declare global {
  interface Window {
    __recVideo: (t: number) => number;
  }
}

window.__recVideo = (t: number) => {
  const d = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : VIDEO_FALLBACK_DURATION;
  return (((t % d) + d) % d) + 1 / 120;
};

function recordLoop(): void {
  const cycle = async () => {
    const start = performance.now();
    await reveal();
    await new Promise((r) => setTimeout(r, Math.max(0, REC_COLLAPSE_AT - (performance.now() - start))));
    await collapse();
    cycle();
  };
  cycle();
}

/* ---------- start ---------- */

async function fontsReady(): Promise<void> {
  const timeout = new Promise((r) => setTimeout(r, 3000));
  await Promise.race([document.fonts.load('800 100px "Inter"').then(() => document.fonts.ready), timeout]);
}

let started = false;

async function start(): Promise<void> {
  drawLines();
  if (reducedMotion) {
    video.removeAttribute("autoplay");
    video.pause();
    video.currentTime = 0;
    return;
  }
  await fontsReady();
}

/** Shows the landing and plays the reveal from the hairline. */
export async function showLanding(enter: (path: string) => void): Promise<void> {
  onEnter = enter;
  root.hidden = false;
  root.classList.add("pre");
  scrollTo(0, 0);
  initSections(root);
  activateSections();
  if (!started) {
    started = true;
    await start();
  }
  generation++;
  busy = false;
  if (reducedMotion) {
    clear();
    root.classList.remove("pre");
    return;
  }
  build(0);
  root.classList.remove("pre");
  video.play().catch(() => undefined);
  if (recording) recordLoop();
  else void reveal();
}

export function hideLanding(): void {
  generation++;
  clear();
  video.pause();
  deactivateSections();
  root.hidden = true;
}
