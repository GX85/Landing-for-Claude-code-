import "@fontsource/anton/latin-400.css";
import "@fontsource/hurricane/latin-400.css";
import "@fontsource/pixelify-sans/latin-700.css";
import "@fontsource/instrument-serif/latin-400.css";
import "./sections.css";
import "./dark.css";
import { themeButton } from "./theme";
import { focusMark } from "./mark";
import { agentMascot } from "./mascot";
import "@fontsource/playfair-display/latin-900.css";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SVG_NS = "http://www.w3.org/2000/svg";

let root: HTMLElement;
let active = false;
let initialized = false;
let frame = 0;

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

/* ---------- reveal on scroll ---------- */

function setupReveal(): void {
  root.classList.add("reveal-ready");
  const items = [...root.querySelectorAll<HTMLElement>("[data-reveal]")];
  // stagger siblings that enter together
  const groups = new Map<Element, HTMLElement[]>();
  for (const el of items) {
    const list = groups.get(el.parentElement!) ?? [];
    list.push(el);
    groups.set(el.parentElement!, list);
  }
  for (const list of groups.values()) list.forEach((el, i) => el.style.setProperty("--d", `${Math.min(i * 80, 480)}ms`));

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
  );
  items.forEach((el) => io.observe(el));
}

/* ---------- words that light up as you read ---------- */

function setupStatement(): HTMLElement[] {
  const el = root.querySelector<HTMLElement>("[data-words]");
  if (!el) return [];
  const words = el.textContent!.trim().split(/\s+/);
  el.textContent = "";
  return words.map((w, i) => {
    const span = document.createElement("span");
    span.className = "w";
    span.textContent = w;
    el.append(span, i < words.length - 1 ? " " : "");
    return span;
  });
}

/* ---------- counters ---------- */

function setupCounters(): void {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const el = e.target as HTMLElement;
        const to = Number(el.dataset.count);
        const suffix = el.dataset.suffix ?? "";
        if (reducedMotion) continue;
        const start = performance.now();
        const tick = (now: number) => {
          const t = clamp((now - start) / 1400);
          el.textContent = `${Math.round(to * easeOutExpo(t))}${t >= 1 ? suffix : ""}`;
          if (t < 1) requestAnimationFrame(tick);
        };
        el.textContent = "0";
        requestAnimationFrame(tick);
      }
    },
    { threshold: 0.6 },
  );
  root.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => io.observe(el));
}

/* ---------- brand marquee ---------- */

function setupMarquee(): void {
  const marquee = root.querySelector<HTMLElement>("[data-marquee]");
  const track = marquee?.querySelector<HTMLElement>(".marquee-track");
  if (!marquee || !track) return;
  const originals = [...track.children] as HTMLElement[];

  const build = () => {
    track.replaceChildren(...originals);
    if (reducedMotion) return;
    // one half must be at least as wide as the screen, then the half is doubled
    const unit = originals.reduce((w, el) => w + el.getBoundingClientRect().width, 0) || 1;
    const copies = Math.max(1, Math.ceil(marquee.clientWidth / unit));
    const half: HTMLElement[] = [];
    for (let i = 0; i < copies; i++) half.push(...originals.map((el) => (i === 0 ? el : clone(el))));
    track.replaceChildren(...half, ...half.map(clone));
    // ~45px per second, whatever the screen width
    track.style.setProperty("--marquee-dur", `${((unit * copies) / 45).toFixed(1)}s`);
  };
  const clone = (el: HTMLElement) => {
    const c = el.cloneNode(true) as HTMLElement;
    c.setAttribute("aria-hidden", "true");
    return c;
  };

  // measure once the brand fonts are in, so widths are right
  document.fonts.ready.then(build);
  let timer = 0;
  addEventListener("resize", () => {
    clearTimeout(timer);
    timer = window.setTimeout(build, 200);
  });

  new IntersectionObserver(([e]) => track.style.setProperty("--marquee-state", e.isIntersecting && active ? "running" : "paused")).observe(marquee);
}

/* ---------- live tiles and videos ---------- */

function setupLive(): void {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        const on = e.isIntersecting && active;
        el.classList.toggle("live", on);
        el.querySelectorAll("video").forEach((v) => {
          if (on && !reducedMotion) {
            v.preload = "auto";
            v.play().catch(() => undefined);
          } else v.pause();
        });
      }
    },
    { threshold: 0.15 },
  );
  root.querySelectorAll<HTMLElement>(".tile, .final-pill").forEach((el) => io.observe(el));

  // the hero clip pauses once it scrolls away
  const screen = root.querySelector<HTMLElement>(".screen");
  const hero = root.querySelector<HTMLVideoElement>(".scene");
  if (screen && hero) {
    new IntersectionObserver(([e]) => {
      if (reducedMotion) return;
      if (e.isIntersecting && active) hero.play().catch(() => undefined);
      else hero.pause();
    }).observe(screen);
  }
}

/* ---------- glass highlights that follow the pointer ---------- */

function setupGlassLight(): void {
  if (reducedMotion || !matchMedia("(hover: hover)").matches) return;
  const lit = root.querySelector<HTMLElement>(".cells-lit");
  let px = 0;
  let py = 0;
  let queued = 0;
  // one style write per frame, and only to the small spotlight layer
  const moveLight = () => {
    queued = 0;
    if (!lit) return;
    const x = px - 240;
    const y = py - 240;
    const size = innerWidth < 720 ? 44 : 56;
    // offset the tiles so the lit window lines up with the floor (centred grid)
    const ox = (innerWidth + 4) / 2 - size / 2 - 2;
    lit.style.cssText = `--sx:${x}px;--sy:${y}px;--bx:${ox - x}px;--by:${-2 - y}px`;
  };
  root.addEventListener("pointerleave", () => lit && (lit.style.cssText = ""));
  root.addEventListener("pointermove", (e) => {
    px = e.clientX;
    py = e.clientY;
    if (!queued) queued = requestAnimationFrame(moveLight);
    const el = (e.target as Element).closest<HTMLElement>(".glass, .glass-nav");
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
  });
}

/* ---------- live demo: a Debate played back ---------- */

const DEMO_SCRIPT = [
  "Use APIs. Three people can't out-train labs that spend billions — and every week on GPUs and infra is a week not talking to customers. Rent the best model today, switch tomorrow.",
  "Build the parts that are yours. If AI is the product, your data and fine-tunes are the moat; pure API apps are one price change away from losing their margin.",
  "APIs win for now. Ship on hosted models, keep prompts and evals in your repo, and log your data from day one — that keeps the door open to fine-tune later without slowing down today.",
];

function setupDemo(): void {
  const win = root.querySelector<HTMLElement>("[data-demo]");
  if (!win) return;
  const agents = [...win.querySelectorAll<HTMLElement>(".demo-agent")];
  let timers: number[] = [];
  let running = false;

  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
    running = false;
  };
  const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
  const status = (a: HTMLElement, text: string, writing = false) => {
    a.querySelector(".demo-status")!.textContent = text;
    a.classList.toggle("writing", writing);
  };

  // types one answer word by word, then calls done
  const type = (a: HTMLElement, text: string, done: () => void) => {
    const out = a.querySelector<HTMLElement>(".demo-text")!;
    const words = text.split(" ");
    let i = 0;
    status(a, "writing", true);
    const step = () => {
      i += 1 + Math.floor(Math.random() * 2);
      out.textContent = words.slice(0, i).join(" ");
      if (i < words.length) later(step, 50 + Math.random() * 70);
      else {
        status(a, "done");
        done();
      }
    };
    step();
  };

  const play = () => {
    stop();
    running = true;
    agents.forEach((a) => {
      a.querySelector(".demo-text")!.textContent = "";
      status(a, "waiting");
    });
    if (reducedMotion) {
      agents.forEach((a, i) => {
        a.querySelector(".demo-text")!.textContent = DEMO_SCRIPT[i];
        status(a, "done");
      });
      return;
    }
    let left = 2;
    const judge = () => {
      if (--left) return;
      status(agents[2], "thinking…");
      later(() => type(agents[2], DEMO_SCRIPT[2], () => later(play, 7000)), 900);
    };
    agents.slice(0, 2).forEach((a, i) => {
      status(a, "thinking…");
      later(() => type(a, DEMO_SCRIPT[i], judge), 600 + i * 450);
    });
  };

  win.querySelector("[data-demo-replay]")?.addEventListener("click", play);
  new IntersectionObserver((entries) => {
    const visible = entries[0].isIntersecting && active;
    if (visible && !running) play();
    else if (!visible && running) stop();
  }, { threshold: 0.35 }).observe(win);
}

/* ---------- build demo: Clorus makes a snake game, which then plays itself ---------- */

function setupBuildDemo(): void {
  const win = root.querySelector<HTMLElement>("[data-build-demo]");
  if (!win) return;
  const steps = [...win.querySelectorAll<HTMLElement>(".bd-steps li")];
  const preview = win.querySelector<HTMLElement>(".bd-preview")!;
  const canvas = win.querySelector<HTMLCanvasElement>(".bd-canvas")!;
  const scoreEl = win.querySelector<HTMLElement>(".bd-score b")!;
  const g = canvas.getContext("2d")!;
  const W = 32;
  const H = 18;
  const C = canvas.width / W;
  let timers: number[] = [];
  let raf = 0;
  let visible = false;

  type P = { x: number; y: number };
  let snake: P[] = [];
  let dir: P = { x: 1, y: 0 };
  let food: P = { x: 0, y: 0 };
  let score = 0;
  let acc = 0;
  let last = 0;

  const placeFood = () => {
    do food = { x: Math.floor(Math.random() * W), y: Math.floor(Math.random() * H) };
    while (snake.some((p) => p.x === food.x && p.y === food.y));
  };
  const reset = () => {
    snake = [{ x: 6, y: 9 }, { x: 5, y: 9 }, { x: 4, y: 9 }];
    dir = { x: 1, y: 0 };
    score = 0;
    scoreEl.textContent = "0";
    placeFood();
  };
  // a greedy little pilot: head for the food without hitting a wall or itself
  const step = () => {
    const head = snake[0];
    const options = [dir, { x: dir.y, y: -dir.x }, { x: -dir.y, y: dir.x }]
      .map((d) => ({ d, p: { x: head.x + d.x, y: head.y + d.y } }))
      .filter(({ p }) => p.x >= 0 && p.y >= 0 && p.x < W && p.y < H && !snake.slice(0, -1).some((b) => b.x === p.x && b.y === p.y))
      .sort((a, b) => Math.abs(a.p.x - food.x) + Math.abs(a.p.y - food.y) - (Math.abs(b.p.x - food.x) + Math.abs(b.p.y - food.y)));
    if (!options.length) return reset();
    dir = options[0].d;
    const next = options[0].p;
    snake.unshift(next);
    if (next.x === food.x && next.y === food.y) {
      score += 10;
      scoreEl.textContent = String(score);
      placeFood();
      if (snake.length > 60) reset();
    } else snake.pop();
  };
  const draw = (t: number) => {
    g.fillStyle = "#07070c";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.strokeStyle = "rgba(120,140,255,.07)";
    g.lineWidth = 1;
    for (let x = 0; x <= W; x++) (g.beginPath(), g.moveTo(x * C + 0.5, 0), g.lineTo(x * C + 0.5, canvas.height), g.stroke());
    for (let y = 0; y <= H; y++) (g.beginPath(), g.moveTo(0, y * C + 0.5), g.lineTo(canvas.width, y * C + 0.5), g.stroke());
    const pulse = 0.6 + Math.sin(t / 180) * 0.25;
    g.shadowBlur = 18;
    g.shadowColor = "#ff3d9a";
    g.fillStyle = `rgba(255,61,154,${pulse + 0.15})`;
    g.beginPath();
    g.arc(food.x * C + C / 2, food.y * C + C / 2, C * 0.34, 0, Math.PI * 2);
    g.fill();
    g.shadowColor = "#39ff88";
    snake.forEach((p, i) => {
      const k = i / snake.length;
      g.fillStyle = `hsl(${150 + k * 40} 100% ${60 - k * 18}%)`;
      g.beginPath();
      g.roundRect(p.x * C + 2, p.y * C + 2, C - 4, C - 4, 5);
      g.fill();
    });
    g.shadowBlur = 0;
  };
  const loop = (t: number) => {
    acc += Math.min(100, t - (last || t));
    last = t;
    while (acc > 95) {
      step();
      acc -= 95;
    }
    draw(t);
    raf = requestAnimationFrame(loop);
  };

  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const play = () => {
    stop();
    reset();
    preview.classList.remove("show");
    steps.forEach((s) => s.classList.remove("on", "done"));
    if (reducedMotion) {
      steps.forEach((s) => s.classList.add("on", "done"));
      preview.classList.add("show");
      draw(0);
      return;
    }
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const marks = [300, 1500, 3400, 4700];
    steps.forEach((s, i) => {
      at(marks[i], () => s.classList.add("on"));
      at((marks[i + 1] ?? marks[i] + 200) - 120, () => s.classList.add("done"));
    });
    at(5100, () => {
      preview.classList.add("show");
      last = 0;
      raf = requestAnimationFrame(loop);
    });
    at(26000, play);
  };

  win.querySelector("[data-build-replay]")?.addEventListener("click", play);
  new IntersectionObserver(
    (entries) => {
      const now = entries[0].isIntersecting && active;
      if (now && !visible) play();
      else if (!now && visible) stop();
      visible = now;
    },
    { threshold: 0.3 },
  ).observe(win);
}

/* ---------- fog texture ---------- */

/** Paints soft clouds once into a small canvas; the fog layers just scale and slide it. */
function makeFog(): void {
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = 320;
  const g = c.getContext("2d")!;
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 26; i++) {
    const x = rand() * 480;
    const y = 60 + rand() * 220;
    const r = 30 + rand() * 90;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.1 + rand() * 0.2;
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(x, y, r * 1.8, r, 0, 0, Math.PI * 2);
    g.fill();
  }
  root.querySelector<HTMLElement>(".fog")?.style.setProperty("--fog-img", `url(${c.toDataURL("image/png")})`);
}

/* ---------- smooth anchors ---------- */

function setupAnchors(): void {
  root.addEventListener("click", (e) => {
    const link = (e.target as Element).closest<HTMLAnchorElement>("a[data-scroll]");
    if (!link) return;
    const target = root.querySelector(link.hash);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  });
}

/* ---------- FAQ: animated open and close ---------- */

function setupFaq(): void {
  root.querySelectorAll<HTMLDetailsElement>(".qa").forEach((qa) => {
    const summary = qa.querySelector("summary")!;
    const body = qa.querySelector<HTMLElement>(".qa-body")!;
    summary.addEventListener("click", (e) => {
      if (reducedMotion) return;
      e.preventDefault();
      if (qa.open) {
        const a = body.animate([{ height: `${body.offsetHeight}px` }, { height: "0px" }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
        a.onfinish = () => (qa.open = false);
      } else {
        qa.open = true;
        body.animate([{ height: "0px", opacity: 0 }, { height: `${body.offsetHeight}px`, opacity: 1 }], { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    });
  });
}

/* ---------- scroll-linked effects ---------- */

let words: HTMLElement[] = [];
let nav: HTMLElement | null;
let screen: HTMLElement | null;
let how: HTMLElement | null;
let statement: HTMLElement | null;

function onScroll(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (!active) return;
    const y = scrollY;
    const vh = innerHeight;
    nav?.classList.toggle("scrolled", y > 24);
    const hp = screen ? clamp(y / (screen.offsetHeight * 0.85)) : 0;
    root.style.setProperty("--hp", hp.toFixed(3));

    if (statement && words.length && !reducedMotion) {
      const r = statement.getBoundingClientRect();
      const p = clamp((vh * 0.82 - r.top) / (r.height + vh * 0.32));
      const lit = Math.round(p * words.length * 1.1);
      words.forEach((w, i) => w.classList.toggle("lit", i < lit));
    }
    if (how) {
      const r = how.getBoundingClientRect();
      how.style.setProperty("--how", (reducedMotion ? 1 : clamp((vh * 0.78 - r.top) / (r.height * 0.95))).toFixed(3));
    }
  });
}

/* ---------- modes: the team, animated ---------- */

type Kind = "agent" | "pill" | "result";
interface DNode {
  id: string;
  x: number;
  y: number;
  kind: Kind;
  label: string;
  color?: string;
  letter?: string;
  w?: number;
}
interface DEdge {
  from: string;
  to: string;
  step: number;
  bend?: number;
}
interface Diagram {
  caption: string;
  nodes: DNode[];
  edges: DEdge[];
  badge?: { node: string; step: number; text: string };
}

const COLOR = { claude: "#d97757", gpt: "#10a37f", gemini: "#4285f4", lead: "#1d1d1d", veo: "#a142f4" };
const R = 24;
const task = (y = 36): DNode => ({ id: "task", x: 280, y, kind: "pill", label: "Your message", w: 148 });
const result = (y = 366, label = "Result", w = 130): DNode => ({ id: "result", x: 280, y, kind: "result", label, w });
const agent = (id: string, x: number, y: number, label: string, color: string, letter = label[0]): DNode => ({ id, x, y, kind: "agent", label, color, letter });
const fan = (from: string, to: string[], step: number): DEdge[] => to.map((t) => ({ from, to: t, step }));
const join = (from: string[], to: string, step: number): DEdge[] => from.map((f) => ({ from: f, to, step }));

const DIAGRAMS: Record<string, Diagram> = {
  solo: {
    caption: "A one-on-one chat with the agent you pick — the quickest way to ask something.",
    nodes: [task(), agent("a", 280, 200, "Claude", COLOR.claude), result()],
    edges: [{ from: "task", to: "a", step: 0 }, { from: "a", to: "result", step: 1 }],
  },
  compare: {
    caption: "Every agent answers on its own, and you see the answers side by side.",
    nodes: [
      task(),
      agent("a", 120, 180, "Claude", COLOR.claude),
      agent("b", 280, 180, "GPT", COLOR.gpt),
      agent("c", 440, 180, "Gemini", COLOR.gemini),
      { ...result(340, "Answer", 96), id: "ra", x: 120 },
      { ...result(340, "Answer", 96), id: "rb", x: 280 },
      { ...result(340, "Answer", 96), id: "rc", x: 440 },
    ],
    edges: [...fan("task", ["a", "b", "c"], 0), { from: "a", to: "ra", step: 1 }, { from: "b", to: "rb", step: 1 }, { from: "c", to: "rc", step: 1 }],
  },
  council: {
    caption: "Everyone answers, then the lead merges the strongest points into a single answer.",
    nodes: [task(), agent("a", 120, 164, "Claude", COLOR.claude), agent("b", 280, 164, "GPT", COLOR.gpt), agent("c", 440, 164, "Gemini", COLOR.gemini), agent("l", 280, 270, "Lead", COLOR.lead, "L"), result()],
    edges: [...fan("task", ["a", "b", "c"], 0), ...join(["a", "b", "c"], "l", 1), { from: "l", to: "result", step: 2 }],
  },
  vote: {
    caption: "Everyone answers; the judge reads them all, picks the best one and says why.",
    nodes: [task(), agent("a", 120, 164, "Claude", COLOR.claude), agent("b", 280, 164, "GPT", COLOR.gpt), agent("c", 440, 164, "Gemini", COLOR.gemini), agent("l", 280, 270, "Judge", COLOR.lead, "J"), result(366, "Best answer", 140)],
    edges: [...fan("task", ["a", "b", "c"], 0), ...join(["a", "b", "c"], "l", 1), { from: "l", to: "result", step: 2 }],
    badge: { node: "b", step: 2, text: "Best" },
  },
  debate: {
    caption: "Agents argue the question over several rounds, answering each other — then the judge gives the verdict.",
    nodes: [task(), agent("a", 150, 176, "Claude", COLOR.claude), agent("b", 410, 176, "GPT", COLOR.gpt), agent("l", 280, 282, "Judge", COLOR.lead, "J"), result(368, "Verdict")],
    edges: [
      ...fan("task", ["a", "b"], 0),
      { from: "a", to: "b", step: 1, bend: -62 },
      { from: "b", to: "a", step: 2, bend: 50 },
      { from: "a", to: "b", step: 3, bend: -62 },
      ...join(["a", "b"], "l", 4),
      { from: "l", to: "result", step: 5 },
    ],
  },
  relay: {
    caption: "Each agent improves the last one's work. Put a video generator last to turn the text into a clip.",
    nodes: [task(), agent("a", 110, 200, "Claude", COLOR.claude), agent("b", 280, 200, "GPT", COLOR.gpt), agent("c", 450, 200, "Veo", COLOR.veo), result(366, "Video")],
    edges: [{ from: "task", to: "a", step: 0 }, { from: "a", to: "b", step: 1 }, { from: "b", to: "c", step: 2 }, { from: "c", to: "result", step: 3 }],
  },
  review: {
    caption: "The author drafts, the reviewer lists problems, the author revises — until the reviewer approves.",
    nodes: [task(), agent("a", 170, 196, "Claude · author", COLOR.claude, "C"), agent("r", 390, 196, "GPT · reviewer", COLOR.gpt, "G"), result()],
    edges: [
      { from: "task", to: "a", step: 0 },
      { from: "a", to: "r", step: 1, bend: -58 },
      { from: "r", to: "a", step: 2, bend: 58 },
      { from: "a", to: "r", step: 3, bend: -58 },
      { from: "a", to: "result", step: 4 },
    ],
    badge: { node: "r", step: 4, text: "Approved" },
  },
  planner: {
    caption: "The lead splits the task into parts, the team works on them in parallel, and the lead assembles the result.",
    nodes: [
      task(30),
      agent("l", 280, 112, "Lead · plan", COLOR.lead, "L"),
      agent("a", 120, 210, "Claude", COLOR.claude),
      agent("b", 280, 210, "Gemini", COLOR.gemini),
      agent("c", 440, 210, "Veo", COLOR.veo),
      agent("l2", 280, 300, "Lead · assemble", COLOR.lead, "L"),
      result(374),
    ],
    edges: [{ from: "task", to: "l", step: 0 }, ...fan("l", ["a", "b", "c"], 1), ...join(["a", "b", "c"], "l2", 2), { from: "l2", to: "result", step: 3 }],
  },
};

const ORDER = ["solo", "compare", "council", "vote", "debate", "relay", "review", "planner"];
const STEP_MS = 950;
const HOLD_MS = 1500;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...children: (Node | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...children);
  return el;
}

const halfHeight = (n: DNode) => (n.kind === "agent" ? R : 17);

/** A smooth path from one node to another; `bend` arcs it sideways for back-and-forth edges. */
function edgePath(a: DNode, b: DNode, bend = 0): string {
  if (bend) {
    const dir = Math.sign(b.x - a.x);
    const c1x = a.x + (b.x - a.x) / 3;
    const c2x = b.x - (b.x - a.x) / 3;
    const cy = a.y + bend * 1.35;
    const start = { x: a.x + dir * R * 0.55, y: a.y + Math.sign(bend) * R * 0.84 };
    const end = { x: b.x - dir * R * 0.55, y: b.y + Math.sign(bend) * R * 0.84 };
    return `M${start.x} ${start.y} C${c1x} ${cy} ${c2x} ${cy} ${end.x} ${end.y}`;
  }
  if (Math.abs(b.y - a.y) < 10) {
    const dir = Math.sign(b.x - a.x);
    return `M${a.x + dir * R} ${a.y} L${b.x - dir * R} ${b.y}`;
  }
  const down = Math.sign(b.y - a.y);
  const y1 = a.y + down * halfHeight(a);
  const y2 = b.y - down * halfHeight(b);
  const mid = (y1 + y2) / 2;
  return `M${a.x} ${y1} C${a.x} ${mid} ${b.x} ${mid} ${b.x} ${y2}`;
}

function setupModes(): void {
  const stage = root.querySelector<HTMLElement>(".mode-stage");
  const svgEl = root.querySelector<SVGSVGElement>(".mode-svg");
  const caption = root.querySelector<HTMLElement>(".mode-caption");
  const tabs = [...root.querySelectorAll<HTMLButtonElement>(".mode-tabs [data-mode]")];
  if (!stage || !svgEl || !caption || !tabs.length) return;

  let current = "council";
  let started = 0;
  let pinnedUntil = 0;
  let visible = false;
  let raf = 0;
  let parts: {
    diagram: Diagram;
    cycle: number;
    edges: { el: SVGPathElement; pulse: SVGCircleElement; len: number; step: number; to: string }[];
    nodes: Map<string, SVGGElement>;
    badge?: SVGGElement;
  };

  const render = (id: string) => {
    const d = DIAGRAMS[id];
    const byId = new Map(d.nodes.map((n) => [n.id, n]));
    const edgeLayer = svg("g", {});
    const pulseLayer = svg("g", {});
    const nodeLayer = svg("g", {});
    const edges = d.edges.map((e) => {
      const from = byId.get(e.from)!;
      const el = svg("path", { class: "edge", d: edgePath(from, byId.get(e.to)!, e.bend) });
      const pulse = svg("circle", { class: "pulse", r: 5, fill: from.color ?? "#1d1d1d", opacity: 0 });
      edgeLayer.append(el);
      pulseLayer.append(pulse);
      return { el, pulse, len: 0, step: e.step, to: e.to };
    });
    const nodes = new Map<string, SVGGElement>();
    for (const n of d.nodes) {
      let g: SVGGElement;
      if (n.kind === "agent") {
        g = svg(
          "g",
          { class: "node", transform: `translate(${n.x} ${n.y})` },
          svg("circle", { class: "node-ring", r: R, stroke: n.color! }),
          svg("circle", { r: R, fill: n.color! }),
          svg("text", { class: "node-letter" }, n.letter ?? ""),
          svg("text", { class: "node-label", y: R + 18 }, n.label),
        );
      } else {
        const w = n.w ?? 120;
        g = svg(
          "g",
          { class: `node ${n.kind === "result" ? "result" : "task"}`, transform: `translate(${n.x} ${n.y})` },
          svg("rect", { class: "pill-box", x: -w / 2, y: -17, width: w, height: 34, rx: 17 }),
          svg("text", { class: "pill-text" }, n.label),
        );
      }
      nodes.set(n.id, g);
      nodeLayer.append(g);
    }
    let badge: SVGGElement | undefined;
    if (d.badge) {
      const n = byId.get(d.badge.node)!;
      const w = d.badge.text.length * 7 + 18;
      badge = svg("g", { class: "badge" }, svg("rect", { x: n.x - w / 2, y: n.y - R - 30, width: w, height: 20, rx: 10 }), svg("text", { x: n.x, y: n.y - R - 20 }, d.badge.text));
      nodeLayer.append(badge);
    }
    svgEl.replaceChildren(edgeLayer, pulseLayer, nodeLayer);
    edges.forEach((e) => (e.len = e.el.getTotalLength()));
    const steps = Math.max(...d.edges.map((e) => e.step)) + 1;
    parts = { diagram: d, cycle: steps * STEP_MS + HOLD_MS, edges, nodes, badge };
    caption.textContent = d.caption;
    for (const t of tabs) t.setAttribute("aria-selected", String(t.dataset.mode === id));
    svgEl.setAttribute("aria-label", `${tabs.find((t) => t.dataset.mode === id)?.querySelector("b")?.textContent} mode: ${d.caption}`);
    if (reducedMotion) paint(Infinity);
  };

  /** Draws the diagram `elapsed` ms into its cycle. */
  const paint = (elapsed: number) => {
    const lit = new Set<string>(["task"]);
    for (const e of parts.edges) {
      const local = (elapsed - e.step * STEP_MS) / STEP_MS;
      const moving = local > 0 && local < 1;
      if (moving) {
        const p = e.el.getPointAtLength(e.len * easeInOut(local));
        e.pulse.setAttribute("cx", p.x.toFixed(1));
        e.pulse.setAttribute("cy", p.y.toFixed(1));
      }
      e.pulse.setAttribute("opacity", moving ? "1" : "0");
      e.el.classList.toggle("lit", local >= 1);
      if (local >= 1) lit.add(e.to);
    }
    for (const [id, g] of parts.nodes) g.classList.toggle("lit", lit.has(id));
    if (parts.badge && parts.diagram.badge) parts.badge.classList.toggle("on", elapsed >= (parts.diagram.badge.step + 0.4) * STEP_MS);
  };

  const loop = (now: number) => {
    raf = 0;
    if (!visible || !active) return;
    let elapsed = now - started;
    if (elapsed >= parts.cycle) {
      if (now >= pinnedUntil) current = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
      render(current);
      started = now;
      elapsed = 0;
    }
    paint(elapsed);
    tabs.find((t) => t.dataset.mode === current)?.style.setProperty("--p", (elapsed / parts.cycle).toFixed(3));
    raf = requestAnimationFrame(loop);
  };

  const run = () => {
    if (reducedMotion || raf || !visible || !active) return;
    started = performance.now();
    raf = requestAnimationFrame(loop);
  };

  tabs.forEach((t) =>
    t.addEventListener("click", () => {
      current = t.dataset.mode!;
      pinnedUntil = performance.now() + 15_000;
      tabs.forEach((x) => x.style.setProperty("--p", "0"));
      render(current);
      started = performance.now();
      t.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }),
  );

  render(current);
  new IntersectionObserver(
    ([e]) => {
      visible = e.isIntersecting;
      if (visible) run();
    },
    { threshold: 0.25 },
  ).observe(stage);

  restartModes = () => {
    visible = stage.getBoundingClientRect().top < innerHeight && stage.getBoundingClientRect().bottom > 0;
    run();
  };
}

let restartModes = () => undefined as void;

/* ---------- lifecycle ---------- */

export function initSections(el: HTMLElement): void {
  if (initialized) return;
  initialized = true;
  root = el;
  nav = root.querySelector(".nav");
  screen = root.querySelector(".screen");
  how = root.querySelector(".how-steps");
  statement = root.querySelector("[data-words]");
  words = setupStatement();
  if (reducedMotion) words.forEach((w) => w.classList.add("lit"));
  root.querySelector("[data-theme-slot]")?.replaceWith(themeButton("nav-theme"));
  makeFog();
  setupDemo();
  setupBuildDemo();
  root.querySelectorAll("[data-mark]").forEach((el) => el.replaceWith(focusMark(26)));
  root.querySelectorAll<HTMLElement>(".skill-chips b").forEach((b, i) => b.style.setProperty("--i", String(i)));
  root.querySelectorAll("[data-mascot]").forEach((el) => el.replaceChildren(agentMascot("#ffffff", 34)));
  setupReveal();
  setupCounters();
  setupMarquee();
  setupLive();
  setupGlassLight();
  setupAnchors();
  setupFaq();
  setupModes();
}

/** Starts scroll effects and animations; called whenever the landing is shown. */
export function activateSections(): void {
  active = true;
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  onScroll();
  restartModes();
}

export function deactivateSections(): void {
  active = false;
  removeEventListener("scroll", onScroll);
  removeEventListener("resize", onScroll);
  root?.querySelectorAll("video").forEach((v) => v.pause());
}
