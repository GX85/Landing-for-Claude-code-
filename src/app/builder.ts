/**
 * Focus Builder: turns "make me a game / site / app / presentation" into a working page.
 *
 * Free models are good at code but sloppy, so the builder does what a careful engineer would:
 * it asks for the whole file, finishes it when the answer is cut off, runs it in a hidden sandbox,
 * and sends any errors back for a fix. Presentations are written as structured content and laid
 * out by a hand-made template, so they always look right.
 */

import type { ChatTurn } from "./api";
import { closestGame, exampleGameJs, renderCustomGame, renderGame, type GameConfig } from "./templates/games";
import { themeNames } from "./templates/kit";

export type BuildKind = "presentation" | "game" | "website" | "app";

export interface BuildCall {
  (system: string, messages: ChatTurn[], onText: (full: string) => void, maxTokens?: number): Promise<{ text: string }>;
}

const RX: Record<BuildKind, RegExp> = {
  presentation: /(презентац|слайд|presentation|\bslides?\b|slide ?deck|pitch ?deck|keynote|питч)/i,
  game: /(игр[уаыеой]|\bgame|\b3d\b|3д|тетрис|змейк|snake|tetris|platformer|платформер|шутер|shooter|\bpong\b|flappy|arkanoid|арканоид|гонк|racing)/i,
  website: /(сайт|лендинг|landing|website|web ?site|веб-?страниц|homepage|портфолио|portfolio|страниц[уа] для|web ?page)/i,
  app: /(приложени|\bapp\b|application|калькулятор|calculator|\btodo\b|to-do|список дел|трекер|tracker|дашборд|dashboard|таймер|timer|конвертер|converter|редактор|editor|виджет|widget|pomodoro|помодоро)/i,
};
const VERB = /(сделай|создай|напиши|построй|сгенерируй|собери|сверстай|запили|накидай|придумай и сделай|\bmake\b|\bbuild\b|\bcreate\b|\bgenerate\b|\bdesign\b|\bcode\b|\bdevelop\b)/i;
const NOT_A_BUILD = /(объясни|расскажи|что такое|почему|explain|what is|why does|how does|history of|история)/i;

/** What the user wants built, or null for an ordinary question. */
export function detectBuild(text: string): BuildKind | null {
  const t = text.slice(0, 800);
  if (!VERB.test(t) || NOT_A_BUILD.test(t)) return null;
  for (const kind of ["presentation", "game", "website", "app"] as BuildKind[]) if (RX[kind].test(t)) return kind;
  return null;
}

const LABEL: Record<BuildKind, [string, string]> = {
  presentation: ["presentation", "презентацию"],
  game: ["game", "игру"],
  website: ["website", "сайт"],
  app: ["app", "приложение"],
};

/* ---------- prompts ---------- */

const BUILD_SYSTEM = `You are Focus Builder, a senior front-end engineer and product designer. Build exactly what the user asked for as ONE complete, self-contained HTML file.

Output: one short sentence, then a single \`\`\`html code block with the whole file from <!DOCTYPE html> to </html>, then one short line on how to use it. Nothing else.

Hard rules:
- Everything inline: CSS in <style>, JavaScript in <script>. No build step, no ES modules or imports, no external images, fonts or files. The ONE allowed external file is three.js r128 for 3D: <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script> (use the global THREE; no OrbitControls or other add-ons, write your own controls).
- It must run with zero errors on the first try: declare every variable, check elements exist, no unfinished code, no "TODO", no "add more here", no placeholder text.
- Works on phones and desktops: responsive layout and touch controls as well as keyboard and mouse.
- All visible text in the user's language.
- Make it look designed, not like a tutorial: a coherent colour palette, a system font stack with real hierarchy, generous spacing, soft shadows, smooth transitions.`;

const KIND_RULES: Record<Exclude<BuildKind, "presentation">, string> = {
  game: `Game requirements: a title screen with a Start button and a controls hint; score and a best score saved in localStorage; a game-over screen with Restart; difficulty that ramps up; a requestAnimationFrame loop using delta time; a canvas that fills the window and handles resize and devicePixelRatio; pause when the tab is hidden. Add juice: particles, easing, a little screen shake. On touch screens show on-screen buttons or use swipes. For 3D use three.js r128 with lights, fog and simple procedural low-poly geometry, and keep it smooth on phones.`,
  website: `Website requirements: a complete page with a sticky nav (and a mobile menu), a hero with a strong headline and call to action, 3 to 5 content sections (for example features, how it works, testimonials or pricing, FAQ) and a footer. Specific, persuasive copy for this exact business, never lorem ipsum. Use CSS gradients, inline SVG and emoji instead of image files. Smooth scrolling and gentle reveal-on-scroll animations.`,
  app: `App requirements: every feature actually works; state is saved in localStorage; friendly empty states; input validation; keyboard shortcuts where natural; accessible labels. An app-like layout that fits a phone screen and scales up nicely.`,
};

const DECK_SYSTEM = `You are Focus, a presentation designer and writer. Turn the user's request into a slide deck. Reply with ONLY a JSON object: no code fences, no comments, no text before or after.

Schema:
{"title": string, "theme": "aurora" | "sunset" | "paper" | "mono" | "forest" | "ocean", "slides": Slide[]}
A Slide is one of:
{"layout":"title","kicker":string,"title":string,"subtitle":string}
{"layout":"section","number":string,"title":string,"subtitle":string}
{"layout":"bullets","title":string,"bullets":string[]}   // 3 to 5 bullets, each at most 14 words
{"layout":"twocol","title":string,"left":{"heading":string,"items":string[]},"right":{"heading":string,"items":string[]}}
{"layout":"stats","title":string,"stats":[{"value":string,"label":string}]}   // 2 to 4 stats
{"layout":"quote","quote":string,"author":string}
{"layout":"steps","title":string,"steps":[{"title":string,"text":string}]}   // 3 to 5 steps
{"layout":"closing","title":string,"subtitle":string}

Rules: 8 to 12 slides unless the user asks for a number. Start with "title" and end with "closing". Mix the layouts and tell a story with a clear arc. Specific, vivid, useful content, no placeholders. If you invent numbers, make them plausible and mark them as estimates in the label. All text in the user's language. Pick the theme that suits the topic.`;

/* ---------- helpers ---------- */

const isRu = (text: string) => /[а-яё]/i.test(text);

/** The HTML file inside a reply, even when the code fence never closed. */
function extractHtml(text: string): string {
  const fenced = /```html?\s*\n([\s\S]*?)(```|$)/i.exec(text);
  let html = fenced ? fenced[1] : text;
  const start = html.search(/<!doctype html|<html/i);
  if (start > 0) html = html.slice(start);
  return html.replace(/<!--\s*focus:preview[^>]*-->\s*/i, "").trim();
}

/** The sentence the model wrote before its code block, if any. */
function introOf(text: string): string {
  const before = text.split(/```/)[0].trim();
  return before.length > 0 && before.length < 300 ? before : "";
}

const complete = (html: string) => /<\/html>\s*$/i.test(html.trim());

/** Strips fences and chatter from a continuation, keeping only code. */
function cleanTail(text: string): string {
  return text
    .replace(/^[\s\S]*?```html?\s*\n/i, (m) => (/```/.test(m) ? "" : m))
    .replace(/```[\s\S]*$/, "")
    .replace(/^\s*\n/, "");
}

/**
 * Runs the page in a hidden sandbox for a few seconds, pokes it like a user would
 * (a click, a few keys, a tap in the middle) and collects any errors it reports.
 */
export function validateHtml(html: string, ms = 3200): Promise<string[]> {
  return new Promise((resolve) => {
    const errors: string[] = [];
    const reporter =
      '<script>(function(){var s=function(m){try{parent.postMessage({focusCheck:1,msg:String(m).slice(0,300)},"*")}catch(e){}};' +
      'addEventListener("error",function(e){if(e.target&&e.target!==window&&e.target.src){s("Could not load "+e.target.src);return}s((e.message||"Error")+(e.lineno?" (line "+e.lineno+")":""))},true);' +
      'addEventListener("unhandledrejection",function(e){s("Unhandled promise rejection: "+(e.reason&&e.reason.message||e.reason))});' +
      'var ce=console.error;console.error=function(){s("console.error: "+Array.prototype.join.call(arguments," "));return ce.apply(console,arguments)};' +
      'setTimeout(function(){try{var b=document.querySelector("button");if(b)b.click();["Enter"," ","ArrowRight","ArrowUp","ArrowLeft","KeyW"].forEach(function(k){var ev=new KeyboardEvent("keydown",{key:k.length===1?k:k.replace("Key","").toLowerCase(),code:k,bubbles:true});document.dispatchEvent(ev);window.dispatchEvent(ev)});' +
      'var c=document.elementFromPoint(innerWidth/2,innerHeight/2);if(c){["pointerdown","mousedown","pointerup","mouseup","click"].forEach(function(t){c.dispatchEvent(new MouseEvent(t,{bubbles:true,clientX:innerWidth/2,clientY:innerHeight/2}))})}}catch(e){s(e&&e.message||e)}},900)})();</script>';
    const doc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + reporter) : reporter + html;
    let frame: HTMLIFrameElement;
    const onMessage = (e: MessageEvent) => {
      if (e.source === frame?.contentWindow && (e.data as { focusCheck?: number })?.focusCheck) errors.push((e.data as { msg: string }).msg);
    };
    try {
      frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      frame.style.cssText = "position:fixed;left:-10000px;top:0;width:820px;height:620px;border:0;opacity:0;pointer-events:none";
      addEventListener("message", onMessage);
      document.body.append(frame);
      frame.srcdoc = doc;
    } catch {
      resolve([]);
      return;
    }
    setTimeout(() => {
      removeEventListener("message", onMessage);
      frame.remove();
      resolve([...new Set(errors)].slice(0, 6));
    }, ms);
  });
}

/* ---------- the build ---------- */

export async function runBuild(kind: BuildKind, messages: ChatTurn[], call: BuildCall, onText: (full: string) => void, signal: AbortSignal): Promise<string> {
  const ask = messages.at(-1)?.content ?? "";
  const ru = isRu(ask);
  const what = LABEL[kind][ru ? 1 : 0];
  const say = (en: string, rus: string) => (ru ? rus : en);
  if (kind === "presentation") return buildDeck(messages, call, onText, ru);
  if (kind === "game") return buildGame(messages, call, onText, signal, ru);

  const system = `${BUILD_SYSTEM}\n\n${KIND_RULES[kind]}`;
  const status = (line: string, body = "") => onText(`*${line}*${body ? `\n\n${body}` : ""}`);

  // 1. write it, showing the code as it streams
  status(say(`Building your ${what}…`, `Собираю ${what}…`));
  let reply = await call(system, messages, (t) => status(say(`Building your ${what}…`, `Собираю ${what}…`), t), 16000);
  let html = extractHtml(reply.text);
  const intro = introOf(reply.text);

  // 2. finish it if the answer was cut off
  for (let i = 0; i < 2 && html && !complete(html); i++) {
    if (signal.aborted) break;
    status(say("Finishing the code…", "Дописываю код…"));
    const more = await call(
      system,
      [
        ...messages,
        { role: "assistant", content: "```html\n" + html },
        { role: "user", content: "You were cut off. Continue EXACTLY where you stopped: no repetition, no commentary, only the remaining code, ending with </html>." },
      ],
      () => status(say("Finishing the code…", "Дописываю код…")),
      16000,
    );
    html += "\n" + cleanTail(more.text);
  }
  if (!html || !/<(html|body|script|canvas|div)\b/i.test(html)) return reply.text;

  // 3. run it, and send errors back until it's clean (twice at most)
  let errors = await validateHtml(html);
  for (let round = 0; round < 2 && errors.length && !signal.aborted; round++) {
    status(say(`Found ${errors.length} error${errors.length > 1 ? "s" : ""} while testing, fixing…`, `Нашёл ошибки при запуске (${errors.length}), исправляю…`));
    reply = await call(
      system,
      [
        ...messages,
        { role: "assistant", content: "```html\n" + html + "\n```" },
        { role: "user", content: `I ran it and got these errors:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nFind the cause and fix it. Reply with the COMPLETE corrected file in one \`\`\`html block.` },
      ],
      (t) => status(say("Fixing…", "Исправляю…"), t),
      16000,
    );
    const fixed = extractHtml(reply.text);
    if (fixed && /<(html|body|script|canvas)\b/i.test(fixed)) {
      html = fixed;
      for (let i = 0; i < 2 && !complete(html); i++) {
        const more = await call(system, [...messages, { role: "assistant", content: "```html\n" + html }, { role: "user", content: "Continue EXACTLY where you stopped, only the remaining code, ending with </html>." }], () => undefined, 16000);
        html += "\n" + cleanTail(more.text);
      }
    }
    errors = await validateHtml(html);
  }

  const checked = errors.length
    ? say(`⚠️ One thing still reports an error (${errors[0]}). Tell me what you see and I'll fix it.`, `⚠️ Осталась ошибка (${errors[0]}). Напиши, что видишь, и я поправлю.`)
    : say("✅ Tested: it runs without errors. Tap **Full screen** to play with it, or tell me what to change.", "✅ Проверил: запускается без ошибок. Жми **Full screen** или скажи, что поменять.");
  return `${intro || say(`Here's your ${what}.`, `Готово, вот ${what}.`)}\n\n\`\`\`html\n<!-- focus:preview kind=${kind} -->\n${html}\n\`\`\`\n\n${checked}`;
}

/* ---------- presentations ---------- */

interface Deck {
  title?: string;
  theme?: string;
  slides?: Slide[];
}
interface Slide {
  layout?: string;
  kicker?: string;
  number?: string;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  left?: { heading?: string; items?: string[] };
  right?: { heading?: string; items?: string[] };
  stats?: { value?: string; label?: string }[];
  quote?: string;
  author?: string;
  steps?: { title?: string; text?: string }[];
}

function parseDeck(text: string): Deck | null {
  const raw = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(json)?/gi, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const body = raw.slice(start, end + 1);
  for (const candidate of [body, body.replace(/,\s*([}\]])/g, "$1")]) {
    try {
      const deck = JSON.parse(candidate) as Deck;
      if (Array.isArray(deck.slides) && deck.slides.length) return deck;
    } catch {
      // try the cleaned-up version
    }
  }
  return null;
}

async function buildDeck(messages: ChatTurn[], call: BuildCall, onText: (full: string) => void, ru: boolean): Promise<string> {
  const say = (en: string, rus: string) => (ru ? rus : en);
  const progress = (t: string) => {
    const n = (t.match(/"layout"/g) ?? []).length;
    onText(`*${say("Writing your presentation…", "Пишу презентацию…")}${n ? ` ${say("slides", "слайдов")}: ${n}` : ""}*`);
  };
  progress("");
  let reply = await call(DECK_SYSTEM, messages, progress, 8000);
  let deck = parseDeck(reply.text);
  if (!deck) {
    reply = await call(DECK_SYSTEM, [...messages, { role: "assistant", content: reply.text.slice(0, 4000) }, { role: "user", content: "That was not valid JSON. Reply again with ONLY the JSON object, following the schema exactly." }], progress, 8000);
    deck = parseDeck(reply.text);
  }
  if (!deck) return say("I couldn't put the slides together this time. Try again, or tell me the topic in a few more words.", "В этот раз не вышло собрать слайды. Попробуй ещё раз или опиши тему чуть подробнее.");
  const slides = deck.slides!.filter((s) => s && typeof s === "object").slice(0, 20);
  const html = renderDeck({ ...deck, slides });
  return `**${deck.title ?? say("Presentation", "Презентация")}** — ${slides.length} ${say("slides", "слайдов")}. ${say("Use ← → or swipe to move between slides; **Full screen** to present.", "Листай стрелками ← → или свайпом; **Full screen** — для показа.")}\n\n\`\`\`html\n<!-- focus:preview kind=presentation -->\n${html}\n\`\`\``;
}

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const THEMES: Record<string, { bg: string; fg: string; muted: string; a: string; b: string; card: string; blob1: string; blob2: string }> = {
  aurora: { bg: "#0b1026", fg: "#f4f6ff", muted: "#a9b1d6", a: "#8b9cff", b: "#4fe3c1", card: "rgba(255,255,255,.06)", blob1: "#5b5bf0", blob2: "#16c7a5" },
  sunset: { bg: "#1b0f16", fg: "#fff4ee", muted: "#e5b9a8", a: "#ff8a5b", b: "#ffc36b", card: "rgba(255,255,255,.07)", blob1: "#ff5e7e", blob2: "#ff9f43" },
  paper: { bg: "#f6f1e7", fg: "#1d1b16", muted: "#6f685b", a: "#c2410c", b: "#0f766e", card: "rgba(0,0,0,.045)", blob1: "#f4c99b", blob2: "#a7d7cf" },
  mono: { bg: "#0a0a0b", fg: "#fafafa", muted: "#a1a1aa", a: "#ffffff", b: "#a1a1aa", card: "rgba(255,255,255,.06)", blob1: "#3f3f46", blob2: "#27272a" },
  forest: { bg: "#0c1a14", fg: "#effaf3", muted: "#a8c7b5", a: "#7bd389", b: "#f2d479", card: "rgba(255,255,255,.06)", blob1: "#1f7a4d", blob2: "#b8a136" },
  ocean: { bg: "#061a2b", fg: "#eef9ff", muted: "#9cc3d8", a: "#4cc9f0", b: "#a0e7e5", card: "rgba(255,255,255,.06)", blob1: "#1769aa", blob2: "#13b3a6" },
};

function slideHtml(s: Slide, i: number): string {
  // every revealed element gets class "r" and its place in the stagger
  const el = (tag: string, cls: string, k: number, body: string) => `<${tag} class="r${cls ? ` ${cls}` : ""}" style="--i:${k}">${body}</${tag}>`;
  const list = (items: string[] | undefined) => (items ?? []).slice(0, 6).map((t, k) => el("li", "", k + 2, esc(t))).join("");
  switch (s.layout) {
    case "title":
      return `<div class="center">${s.kicker ? el("p", "kicker", 0, esc(s.kicker)) : ""}${el("h1", "", 1, esc(s.title))}${el("p", "sub", 2, esc(s.subtitle))}</div>`;
    case "section":
      return `<div class="center">${el("div", "num", 0, esc(s.number ?? String(i).padStart(2, "0")))}${el("h2", "big", 1, esc(s.title))}${s.subtitle ? el("p", "sub", 2, esc(s.subtitle)) : ""}</div>`;
    case "twocol":
      return `${el("h2", "", 0, esc(s.title))}<div class="cols">${el("div", "card", 1, `<h3>${esc(s.left?.heading)}</h3><ul>${list(s.left?.items)}</ul>`)}${el("div", "card", 2, `<h3>${esc(s.right?.heading)}</h3><ul>${list(s.right?.items)}</ul>`)}</div>`;
    case "stats":
      return `${el("h2", "", 0, esc(s.title))}<div class="stats">${(s.stats ?? []).slice(0, 4).map((x, k) => el("div", "stat card", k + 1, `<b>${esc(x.value)}</b><span>${esc(x.label)}</span>`)).join("")}</div>`;
    case "quote":
      return `<div class="center">${el("blockquote", "", 0, `“${esc(s.quote)}”`)}${s.author ? el("p", "sub", 1, `— ${esc(s.author)}`) : ""}</div>`;
    case "steps":
      return `${el("h2", "", 0, esc(s.title))}<ol class="steps">${(s.steps ?? []).slice(0, 5).map((x, k) => el("li", "", k + 1, `<i>${k + 1}</i><b>${esc(x.title)}</b><span>${esc(x.text)}</span>`)).join("")}</ol>`;
    case "closing":
      return `<div class="center">${el("h1", "", 0, esc(s.title))}${s.subtitle ? el("p", "sub", 1, esc(s.subtitle)) : ""}</div>`;
    default:
      return `${el("h2", "", 0, esc(s.title))}<ul class="bullets">${list(s.bullets ?? s.left?.items)}</ul>`;
  }
}

/** A full, self-contained slide deck: 16:9 stage scaled to fit, keyboard, click and swipe navigation. */
export function renderDeck(deck: Deck): string {
  const t = THEMES[deck.theme ?? ""] ?? THEMES.aurora;
  const slides = (deck.slides ?? []).map((s, i) => `<section class="slide ${esc(s.layout ?? "bullets")}" aria-label="Slide ${i + 1}">${slideHtml(s, i)}</section>`).join("\n");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(deck.title)}</title>
<style>
:root{--bg:${t.bg};--fg:${t.fg};--muted:${t.muted};--a:${t.a};--b:${t.b};--card:${t.card}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;overflow:hidden}
.viewport{position:fixed;inset:0;overflow:hidden}
.stage{position:absolute;left:50%;top:50%;width:1600px;height:900px;transform-origin:center;overflow:hidden;border-radius:18px;background:var(--bg)}
.stage::before,.stage::after{content:"";position:absolute;width:900px;height:900px;border-radius:50%;filter:blur(140px);opacity:.45;pointer-events:none}
.stage::before{background:${t.blob1};top:-420px;left:-300px}.stage::after{background:${t.blob2};bottom:-500px;right:-260px;opacity:.32}
.slide{position:absolute;inset:0;padding:110px 130px;display:flex;flex-direction:column;justify-content:center;gap:42px;opacity:0;visibility:hidden;transform:translateX(60px);transition:opacity .6s ease,transform .7s cubic-bezier(.2,.8,.2,1),visibility .6s;z-index:1}
.slide.on{opacity:1;visibility:visible;transform:none}.slide.past{transform:translateX(-60px)}
.r{opacity:0;transform:translateY(24px);transition:opacity .6s ease calc(var(--i,0)*.11s + .15s),transform .7s cubic-bezier(.2,.8,.2,1) calc(var(--i,0)*.11s + .15s)}
.slide.on .r{opacity:1;transform:none}
.center{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:28px;height:100%}
h1{font-size:112px;line-height:1;letter-spacing:-.04em;font-weight:800;max-width:1250px}
h2{font-size:64px;line-height:1.05;letter-spacing:-.03em;font-weight:780;max-width:1300px}
h2.big{font-size:96px}h3{font-size:30px;color:var(--a);margin-bottom:18px;letter-spacing:-.01em}
.kicker{font-size:22px;letter-spacing:.24em;text-transform:uppercase;color:var(--a);font-weight:700}
.sub{font-size:34px;line-height:1.35;color:var(--muted);max-width:1150px}
.num{font-size:180px;font-weight:900;line-height:.8;background:linear-gradient(120deg,var(--a),var(--b));-webkit-background-clip:text;background-clip:text;color:transparent}
ul{list-style:none;display:grid;gap:22px}
.bullets li,.card li{position:relative;padding-left:46px;font-size:36px;line-height:1.3}
.card li{font-size:28px}
.bullets li::before,.card li::before{content:"";position:absolute;left:0;top:.42em;width:20px;height:20px;border-radius:6px;background:linear-gradient(135deg,var(--a),var(--b))}
.card{background:var(--card);border:1px solid rgba(127,127,127,.18);border-radius:28px;padding:40px 44px;box-shadow:0 30px 60px -40px rgba(0,0,0,.6)}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:36px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:30px}
.stat{display:flex;flex-direction:column;gap:14px}.stat b{font-size:92px;line-height:1;letter-spacing:-.04em;background:linear-gradient(120deg,var(--a),var(--b));-webkit-background-clip:text;background-clip:text;color:transparent}
.stat span{font-size:26px;color:var(--muted);line-height:1.3}
blockquote{font-size:70px;line-height:1.15;letter-spacing:-.025em;font-weight:700;max-width:1300px}
.steps{list-style:none;display:grid;gap:24px}.steps li{display:grid;grid-template-columns:64px 1fr;column-gap:26px;align-items:start}
.steps i{grid-row:span 2;display:grid;place-items:center;width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,var(--a),var(--b));color:var(--bg);font-style:normal;font-weight:800;font-size:28px}
.steps b{font-size:34px}.steps span{font-size:26px;color:var(--muted);line-height:1.35}
.bar{position:absolute;left:0;top:0;height:6px;background:linear-gradient(90deg,var(--a),var(--b));z-index:3;transition:width .6s cubic-bezier(.2,.8,.2,1)}
.foot{position:absolute;left:130px;right:130px;bottom:46px;display:flex;justify-content:space-between;font-size:20px;color:var(--muted);z-index:3;letter-spacing:.02em}
.nav{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);display:flex;gap:10px;z-index:5;opacity:.85}
.nav button{width:46px;height:46px;border-radius:50%;border:0;background:rgba(127,127,127,.22);color:var(--fg);font-size:22px;cursor:pointer;backdrop-filter:blur(10px)}
.nav button:hover{background:rgba(127,127,127,.38)}
@media (prefers-reduced-motion:reduce){.slide,.r{transition:none}}
</style></head>
<body>
<div class="viewport"><div class="stage" id="stage">
<div class="bar" id="bar"></div>
${slides}
<div class="foot"><span>${esc(deck.title)}</span><span id="count"></span></div>
</div></div>
<div class="nav"><button id="prev" aria-label="Previous slide">‹</button><button id="next" aria-label="Next slide">›</button></div>
<script>
(function(){
  var stage=document.getElementById("stage"),slides=[].slice.call(document.querySelectorAll(".slide")),bar=document.getElementById("bar"),count=document.getElementById("count"),cur=0;
  function fit(){var s=Math.min(innerWidth/1600,innerHeight/900);stage.style.transform="translate(-50%,-50%) scale("+s+")";stage.style.borderRadius=(s<1?18:0)+"px"}
  function go(n){cur=Math.max(0,Math.min(slides.length-1,n));slides.forEach(function(el,i){el.classList.toggle("on",i===cur);el.classList.toggle("past",i<cur)});bar.style.width=((cur+1)/slides.length*100)+"%";count.textContent=(cur+1)+" / "+slides.length}
  addEventListener("resize",fit);fit();go(0);
  addEventListener("keydown",function(e){if(["ArrowRight","ArrowDown","PageDown"," ","Enter"].indexOf(e.key)>=0){e.preventDefault();go(cur+1)}else if(["ArrowLeft","ArrowUp","PageUp","Backspace"].indexOf(e.key)>=0){e.preventDefault();go(cur-1)}else if(e.key==="Home")go(0);else if(e.key==="End")go(slides.length-1)});
  document.getElementById("next").onclick=function(e){e.stopPropagation();go(cur+1)};
  document.getElementById("prev").onclick=function(e){e.stopPropagation();go(cur-1)};
  document.querySelector(".viewport").addEventListener("click",function(e){go(e.clientX>innerWidth/3?cur+1:cur-1)});
  var x0=null;addEventListener("touchstart",function(e){x0=e.touches[0].clientX},{passive:true});
  addEventListener("touchend",function(e){if(x0===null)return;var dx=e.changedTouches[0].clientX-x0;if(Math.abs(dx)>40)go(dx<0?cur+1:cur-1);x0=null});
})();
</script>
</body></html>`;
}

/* ---------- games: the model writes the game, the engine runs it ---------- */

const ENGINE_DOC = `You write browser games for the Focus game engine. The engine is already written and tested: it gives you a full-screen canvas scaled for the screen, the game loop, start and game-over screens, score and best-score display, pause when the tab is hidden, keyboard/touch dispatch, particles and screen shake. You write ONLY the game itself.

Write ONE JavaScript function expression: function(api){ ...your game...; return { reset, update, draw, key, swipe, tap, down, move, up, resize } }
(only reset, update and draw are required).

api:
- api.W(), api.H(): canvas size in CSS pixels (changes on resize)
- api.c: colours from the theme {a, b, fg, muted, bg, bg2} (CSS colour strings)
- api.add(n), api.set(n), api.score: the score
- api.end(won): call ONCE when the round is over (won = true for a win)
- api.burst(x, y, color, count): particle explosion; api.shake(px): screen shake
- api.rnd(n): random integer 0..n-1; api.diff: 0.8 / 1 / 1.3 difficulty multiplier
Your methods:
- reset(): set up a fresh round (called before every round and once at load)
- update(dt): dt in seconds (≤ 0.05); called only while playing
- draw(g, t): g is a ready CanvasRenderingContext2D; clear and draw the whole frame; t in seconds. Also called on menus, so never assume update ran.
- key(k, down): k is e.key, letters lower-case ("ArrowLeft", " ", "w"); down is true/false
- swipe(dir): "left" | "right" | "up" | "down"; tap(x, y); down(x, y); move(x, y, pressed); up(x, y); resize(w, h)
For 3D: return { webgl: true, ... }, create new THREE.WebGLRenderer({canvas: document.getElementById("c")}) yourself (three.js r128 is loaded as the global THREE; no add-ons) and render in draw().

Rules: plain JavaScript inside that one function; no modules, imports, DOM building, alert or external files. Declare every variable. Make it fun: clear goal, rising difficulty, juicy feedback (bursts, shake), and good-looking shapes using api.c colours.

Reply in exactly this format:
1. A \`\`\`json block: {"title": string, "subtitle": string, "theme": one of ${"${THEMES}"}, "pad": "dpad" | "lr" | "tetris" | "none", "controls": string, "lang": two-letter code, "text": {"start","restart","score","best","gameOver","win"}}
   pad = the on-screen buttons phones get (they send key("ArrowLeft"...) and key(" ")); "none" for tap/swipe/drag games. All text in the user's language.
2. A \`\`\`js block with the function.
Nothing else.`;

function parseGameReply(text: string): { cfg: Partial<GameConfig>; js: string } | null {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const jsonBlock = /```json\s*\n([\s\S]*?)```/i.exec(clean)?.[1];
  const jsBlock = /```(?:js|javascript)\s*\n([\s\S]*?)(```|$)/i.exec(clean)?.[1];
  if (!jsBlock) return null;
  let cfg: Partial<GameConfig> = {};
  if (jsonBlock) {
    try {
      cfg = JSON.parse(jsonBlock.replace(/,\s*([}\]])/g, "$1")) as Partial<GameConfig>;
    } catch {
      // the game still runs with default texts
    }
  }
  // accept "function(api){…}" with or without a trailing semicolon or a wrapping assignment
  let js = jsBlock.trim().replace(/;\s*$/, "");
  const start = js.search(/function\s*\(\s*api\s*\)/);
  if (start < 0) return null;
  js = js.slice(start);
  return { cfg, js };
}

async function buildGame(messages: ChatTurn[], call: BuildCall, onText: (full: string) => void, signal: AbortSignal, ru: boolean): Promise<string> {
  const say = (en: string, rus: string) => (ru ? rus : en);
  const ask = messages.at(-1)?.content ?? "";
  const closest = closestGame(ask);
  const system = `${ENGINE_DOC.replace("${THEMES}", themeNames.join(", "))}\n\nHere is a complete, working example game for this engine. Use it to see how the API is used; write your own game for the user's request, not a copy:\n\`\`\`js\n${exampleGameJs(closest)}\n\`\`\``;
  const status = (en: string, rus: string, body = "") => onText(`*${say(en, rus)}*${body ? `\n\n${body}` : ""}`);

  let reply = { text: "" };
  let parsed: ReturnType<typeof parseGameReply> = null;
  let cfg: GameConfig = { lang: ru ? "ru" : "en", template: "custom" };
  let html = "";
  let errors: string[] = ["No game code came back."];
  let unreachable = false;
  try {
    status("Designing your game…", "Придумываю игру…");
    reply = await call(system, messages, (t) => status("Writing your game…", "Пишу игру…", t), 16000);
    parsed = parseGameReply(reply.text);
    cfg = { lang: ru ? "ru" : "en", ...(parsed?.cfg ?? {}), template: "custom" };
    html = parsed ? renderCustomGame(cfg, parsed.js) : "";
    errors = html ? await validateHtml(html, 3600) : ["No game code came back."];

    for (let round = 0; round < 2 && errors.length && !signal.aborted; round++) {
      status(`Testing found ${errors.length} problem${errors.length > 1 ? "s" : ""}, fixing…`, `При тесте нашёл ошибки (${errors.length}), исправляю…`);
      const previous = parsed ? "```json\n" + JSON.stringify(cfg) + "\n```\n```js\n" + parsed.js + "\n```" : reply.text.slice(0, 6000);
      reply = await call(
        system,
        [...messages, { role: "assistant", content: previous }, { role: "user", content: `I ran it in the engine and got:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nFind the cause and fix it. Reply again in the exact format: the json block, then the complete fixed js function.` }],
        (t) => status("Fixing…", "Исправляю…", t),
        16000,
      );
      const next = parseGameReply(reply.text);
      if (next) {
        parsed = next;
        cfg = { ...cfg, ...next.cfg, template: "custom" };
        html = renderCustomGame(cfg, next.js);
        errors = await validateHtml(html, 3600);
      }
    }

  } catch (err) {
    // the free models were all unavailable: don't leave the person with an error, hand over a ready game
    if (signal.aborted) throw err;
    unreachable = true;
  }

  if (!errors.length && html) {
    return `${say("Here's your game", "Вот твоя игра")}: **${cfg.title ?? say("Game", "Игра")}**. ${say("I wrote it for your request and tested it: it runs without errors.", "Написал её под твой запрос и проверил: запускается без ошибок.")} ${say("Tap **Full screen** to play, or tell me what to change.", "Жми **Full screen**, чтобы играть, или скажи, что поменять.")}\n\n\`\`\`html\n<!-- focus:preview kind=game -->\n${html}\n\`\`\``;
  }
  // the model's own version wouldn't run: hand over the closest polished game, themed to the request
  const fallback = renderGame({ ...cfg, template: closest });
  if (unreachable) {
    return `${say("The AI models were busy and didn't answer, so here's a ready, tested game instead:", "ИИ-модели сейчас заняты и не ответили, поэтому вот готовая проверенная игра:")} **${closest}**. ${say("Ask again in a minute and I'll write one made for your request.", "Попроси ещё раз через минуту, и я напишу игру именно под твой запрос.")}\n\n\`\`\`html\n<!-- focus:preview kind=game -->\n${fallback}\n\`\`\``;
  }
  return `${say("My own version of this game kept crashing in testing, so here's a polished, tested", "Моя версия игры под этот запрос падала при тестах, поэтому вот готовая проверенная игра в стиле запроса:")} **${cfg.title ?? closest}**${say(" in the same spirit.", ".")} ${say("Ask again and I'll try writing it from scratch once more.", "Попроси ещё раз, и я снова попробую написать её с нуля.")}\n\n\`\`\`html\n<!-- focus:preview kind=game -->\n${fallback}\n\`\`\``;
}
