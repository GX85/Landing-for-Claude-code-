import type { Ctx } from "./app";
import type { ChatTurn } from "./api";
import { h, icon, pageHead, seconds } from "./dom";
import { renderMarkdown, renderMarkdownStreaming } from "./markdown";
import { ACCEPT, dataUrlOf, readAttachments } from "./attachments";
import { generateGreeting, resolveMedia, setConnections, type ImagePart } from "./api";
import { modeInfo, MODES, startRun } from "./modes";
import { detectBuild } from "./builder";
import { click, setSound } from "./sound";
import { agentAvatar, applyHub, focusMark } from "./brand";
import { agentMascot } from "../mascot";
import { setToolsConfig } from "./tools";
import { typeInto as handWrite, typePlaceholder } from "./typing";
import { getLang, tr } from "../i18n";
import { canRecord, startRecording, type Recording } from "./voice";
import { displayUser, profileOf } from "./account";
import { allSkills, choiceModel, connectionOf, isReady, KIND_LABEL, missing, newConnection, PERSONA, PROVIDERS, TIER_ORDER, TIERS, uid, type Agent, type Attachment, type Chat, type ChatConfig, type CreateKind, type FocusAgent, type Hub, type Message, type StepRecord, type Tier } from "./store";

const SCENE_VIDEO = "https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/175fbbcd-e50a-480c-bab2-ca16d4678322.mp4";
const SCENE_POSTER = "https://d2ol7oe51mr4n9.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/726b168c-da47-4682-a255-cc3e02f89bae.jpg";
const HISTORY_CHARS = 200_000;

const SUGGESTIONS: { mode: Chat["config"]["mode"]; text: string; kind?: "image" }[] = [
  { mode: "solo", kind: "image", text: "A floating island with a waterfall above sunset clouds, cinematic, ultra detailed" },
  { mode: "compare", text: "Explain how a transformer model works, in five sentences." },
  { mode: "debate", text: "Should an early-stage startup build its own AI stack or buy one?" },
  { mode: "planner", text: "Plan the launch of a mobile habit-tracking app: positioning, channels and a 4-week timeline." },
  { mode: "review", text: "Write a landing page headline and subheadline for a tool that lets AI models work as a team." },
];

/** Live runs, by chat id. */
const runs = new Map<string, AbortController>();
export const isRunning = (chatId: string) => runs.has(chatId);

/** Setup for the next new chat, before it exists. */
let draft: ChatConfig | undefined;
let pendingAttachments: Attachment[] = [];
/** Process boxes the user opened or closed by hand. */
const processOpen = new Map<string, boolean>();

let view: { chatId?: string; list: HTMLElement; scroller: HTMLElement; ctx: Ctx } | undefined;

/* ---------- view ---------- */

export function renderChat(main: HTMLElement, ctx: Ctx, chat: Chat | undefined): void {
  connectionsRef = ctx.state.connections;
  setConnections(ctx.state.connections);
  const config = chat?.config ?? (draft = { ...structuredClone(ctx.state.config), ...(ctx.state.config.think === 4 ? { think: 0 } : {}) });
  // with Aeronus switched off in Settings, new chats are always Focus
  if (!chat && !ctx.state.settings.teamMode) config.hub = "focus";
  const list = h("div", { class: "thread" });
  const scroller = h("div", { class: "chat-scroll" }, list);
  view = { chatId: chat?.id, list, scroller, ctx };

  const soundBtn = h(
    "button",
    {
      class: "icon-btn sound-btn",
      type: "button",
      title: "Typing sound",
      "aria-label": "Typing sound",
      "aria-pressed": String(ctx.state.sound),
      onclick: (e: Event) => {
        ctx.state.sound = !ctx.state.sound;
        setSound(ctx.state.sound);
        (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(ctx.state.sound));
        ctx.persist();
        if (ctx.state.sound) click();
      },
    },
    "⌨",
  );
  setSound(ctx.state.sound);

  const head = pageHead(
    chat ? h("span", { class: "chat-name", title: chat.title }, chat.title) : h("span", { class: "chat-name muted" }, "New chat"),
    soundBtn,
    chat
      ? h("button", { class: "icon-btn", type: "button", title: "Export as Markdown", "aria-label": "Export as Markdown", onclick: () => exportChat(chat) }, icon("download"))
      : null,
    chat
      ? h(
          "button",
          {
            class: "icon-btn",
            type: "button",
            title: "Delete chat",
            "aria-label": "Delete chat",
            onclick: () => {
              if (!confirm(`Delete “${chat.title}”?`)) return;
              runs.get(chat.id)?.abort();
              ctx.state.chats = ctx.state.chats.filter((c) => c !== chat);
              ctx.persist();
              ctx.go({ name: "chat" }, { replace: true });
            },
          },
          icon("trash"),
        )
      : null,
  );

  applyHub(hubOf(config));
  let onHubChange: (() => void) | undefined;
  const composer = buildComposer(ctx, chat, config, () => onHubChange?.());

  if (!chat || !chat.messages.length) {
    const title = h("h1", { class: "hello-title" });
    const sugg = h("div", { class: "suggestions" });
    let greeting = 0;
    const paint = (animate: boolean) => {
      const hub = hubOf(config);
      const pool = GREETINGS[hub][getLang()];
      title.textContent = pool[Math.floor(Math.random() * pool.length)];
      title.classList.add("waiting");
      // a fresh line from the model each time a new chat opens; the local one stays if it's slow
      const ticket = ++greeting;
      void generateGreeting(hub).then((line) => {
        title.classList.remove("waiting");
        if (!line || ticket !== greeting || !title.isConnected) return;
        typeInto(title, line);
      });
      sugg.replaceChildren(...suggestionsFor(ctx, config, main, chat));
      for (const el of [title, sugg]) {
        el.classList.remove("swap");
        if (animate) {
          void el.offsetWidth;
          el.classList.add("swap");
        }
      }
    };
    onHubChange = () => paint(true);
    paint(false);
    const logo = h("div", { class: "hello-logo", "aria-hidden": "true" });
    const paintLogo = () => {
      const fa = hubOf(config) === "focus" ? focusAgentOf(ctx, config) : undefined;
      logo.classList.toggle("is-agent", !!fa);
      logo.replaceChildren(fa ? agentMascot(fa.color, 76) : waveMark(76));
    };
    paintLogo();
    const repaint = onHubChange;
    onHubChange = () => {
      paintLogo();
      repaint?.();
    };
    main.replaceChildren(head, h("div", { class: "hello" }, logo, title, composer, sugg));
    return;
  }

  for (const m of chat.messages) list.append(messageEl(ctx, chat, m));
  main.replaceChildren(head, scroller, h("div", { class: "composer-dock" }, composer, h("p", { class: "disclaimer" }, "Focus can make mistakes. Check important info.")));
  requestAnimationFrame(() => (scroller.scrollTop = scroller.scrollHeight));
}

const hubOf = (c: ChatConfig): Hub => c.hub ?? "aeronus";

/** Shown at once while the model writes a fresh headline (and kept if it doesn't). */
const GREETINGS: Record<Hub, Record<"en" | "ru", string[]>> = {
  focus: {
    en: ["What shall we focus on?", "Go on, surprise me.", "Brain's warmed up. You?", "Big idea or small fix?", "Let's make something good."],
    ru: ["Ну что, помозгуем?", "Чем удивишь сегодня?", "Мозг разогрет. Начнём?", "Большая идея или мелкий баг?", "Давай сделаем что-то классное."],
  },
  aeronus: {
    en: ["Assemble the team.", "The agents are listening.", "Who's on the case today?", "One task, many minds."],
    ru: ["Собираем команду.", "Агенты на связи.", "Кого отправим на задание?", "Одна задача, много умов."],
  },
};

/** Types a line into an element, a few letters at a time. */
function typeInto(el: HTMLElement, text: string): void {
  const chars = [...text];
  let i = 0;
  el.textContent = "";
  el.classList.add("typing");
  const tick = () => {
    if (!el.isConnected) return;
    i = Math.min(chars.length, i + 1 + Math.floor(Math.random() * 2));
    el.textContent = chars.slice(0, i).join("");
    if (i < chars.length) setTimeout(tick, 28 + Math.random() * 40);
    else el.classList.remove("typing");
  };
  tick();
}

const TIER_SUGGESTIONS: Record<Tier, string[]> = {
  storm: ["Explain how DNS works in five sentences.", "Give me ten name ideas for a coffee shop.", "Pros and cons of remote work, in a quick list.", "Translate “good morning” into eight languages."],
  gen: ["Plan a three-day trip to Tokyo on a budget.", "Explain recursion with a real-life analogy.", "Write a friendly email asking for a deadline extension.", "Compare PostgreSQL and MongoDB for a small app."],
  clorus: ["Build a snake game I can play right here.", "Make a six-slide pitch deck for a coffee subscription.", "Create a landing page for a yoga studio.", "Build a pomodoro timer app with a dark theme."],
};

/** What can be made from the + menu or the start screen. */
const CREATE: { kind: CreateKind; name: string; hint: string; icon: string; ask: string }[] = [
  { kind: "game", name: "Game", hint: "Playable right in the chat", icon: "modes", ask: "Describe the game…" },
  { kind: "presentation", name: "Presentation", hint: "A designed slide deck", icon: "file", ask: "What is the presentation about?" },
  { kind: "image", name: "Image", hint: "A picture from your words", icon: "image", ask: "Describe the picture…" },
  { kind: "video", name: "Video", hint: "A short animated film", icon: "video", ask: "Describe the video…" },
  { kind: "website", name: "Website", hint: "A complete page", icon: "council", ask: "What is the website for?" },
  { kind: "app", name: "App", hint: "A working tool", icon: "planner", ask: "What should the app do?" },
];

let setCreateRef: ((k: CreateKind) => void) | undefined;

function fillInput(main: HTMLElement, text: string): void {
  const input = main.querySelector<HTMLTextAreaElement>(".composer textarea");
  if (!input) return;
  input.value = text;
  input.dispatchEvent(new Event("input"));
  input.focus();
}

/** The starter chips under the composer: tier-specific in Focus, mode-specific in Aeronus. */
function suggestionsFor(ctx: Ctx, config: ChatConfig, main: HTMLElement, chat: Chat | undefined): Node[] {
  const fa = hubOf(config) === "focus" ? focusAgentOf(ctx, config) : undefined;
  const starters = fa?.starters.filter((s) => s.trim()) ?? [];
  if (fa && starters.length) {
    return starters.map((text) =>
      h("button", { class: "suggestion", type: "button", onclick: () => fillInput(main, text) }, h("span", { class: "suggestion-mode" }, agentMascot(fa.color, 15), fa.name), h("span", {}, text)),
    );
  }
  if (hubOf(config) === "focus") {
    return [
      h("div", { class: "create-row" }, ...CREATE.map((c) => h("button", { class: "create-chip", type: "button", onclick: () => setCreateRef?.(c.kind) }, icon(c.icon, 15), h("span", {}, c.name)))),
      ...TIER_SUGGESTIONS[config.tier].map((text) =>
      h(
        "button",
        { class: "suggestion", type: "button", onclick: () => fillInput(main, text) },
        h("span", { class: `suggestion-mode tier-${config.tier}` }, TIERS[config.tier].name),
        h("span", {}, text),
      ),
    ),
    ];
  }
  if (!ctx.state.agents.some((a) => isReady(ctx.state, a))) {
    return [
      h(
        "a",
        {
          class: "setup-hint",
          href: "/app/connections",
          onclick: (e: Event) => {
            e.preventDefault();
            ctx.go({ name: "connections" });
          },
        },
        icon("key", 16),
        "Add an API key in Connections to start",
      ),
    ];
  }
  return SUGGESTIONS.filter((s) => !s.kind || ctx.state.agents.some((a) => a.kind === s.kind && isReady(ctx.state, a)))
    .slice(0, 4)
    .map((s) =>
      h(
        "button",
        {
          class: "suggestion",
          type: "button",
          onclick: () => {
            config.mode = s.mode;
            ctx.state.config.mode = s.mode;
            const maker = s.kind && ctx.state.agents.find((a) => a.kind === s.kind && isReady(ctx.state, a));
            if (maker) config.leadId = ctx.state.config.leadId = maker.id;
            ctx.persist();
            renderChat(main, ctx, chat);
            fillInput(main, s.text);
          },
        },
        h("span", { class: "suggestion-mode" }, icon(s.kind ?? modeInfo(s.mode).icon, 15), s.kind ? "Image" : modeInfo(s.mode).name),
        h("span", {}, s.text),
      ),
    );
}

/** The thinking levels, as the slider shows them. */
const THINK: { name: string; short?: string; hint: string }[] = [
  { name: "Auto", hint: "Focus decides for every message: a quick reply to “hi”, deep thinking for hard questions and builds." },
  { name: "Quick", hint: "Answers right away and keeps it short. Best for small talk and simple facts." },
  { name: "Think", hint: "Thinks it through before answering. A good default for real questions." },
  { name: "Deep", hint: "Reasons step by step, checks its work and goes long. Slower, but sharper on hard problems." },
  { name: "UltraVision", short: "Ultra", hint: "The strongest mode: the best models write a draft, tear it apart like a strict reviewer and rewrite it. Twice as slow, noticeably smarter." },
];

const TIER_COLORS: Record<Tier, string> = { storm: "#e5484d", gen: "#8b5cf6", clorus: "#f59e0b" };

/** The Focus agent a chat talks to, if one is chosen and still exists. */
const focusAgentOf = (ctx: Ctx, config: ChatConfig): FocusAgent | undefined => (config.agentId ? ctx.state.focusAgents.find((a) => a.id === config.agentId) : undefined);

const STYLE_NOTE: Record<FocusAgent["style"], string> = {
  short: "Keep answers short: a few sentences or a tight list unless asked for more.",
  balanced: "Match the length to the question.",
  detailed: "Give thorough, well-structured answers with examples.",
};

/** An agent the user built, as a runnable agent: its own personality on top of Focus's brain. */
function builtAgent(ctx: Ctx, fa: FocusAgent): Agent {
  const base = tierAgent(ctx, fa.tier, fa.think);
  const identity = `You are ${fa.name || "an agent"}, a custom AI agent the user built in Focus (by Team Swift).`;
  const skills = allSkills(ctx.state)
    .filter((sk) => fa.skills.includes(sk.id) && sk.instructions.trim())
    .map((sk) => `Skill, ${sk.name}: ${sk.instructions.trim()}`);
  return {
    ...base,
    id: `fa-${fa.id}`,
    name: fa.name || "Agent",
    color: fa.color,
    role: [
      PERSONA.replace(/^You are Focus[^\n]*/, identity),
      fa.instructions.trim() ? `How your user designed you (follow this closely):\n${fa.instructions.trim()}` : "",
      STYLE_NOTE[fa.style],
      ...skills,
    ]
      .filter(Boolean)
      .join("\n\n"),
    prefer: fa.model || undefined,
    temperature: Math.round((0.2 + fa.creativity * 1.0) * 100) / 100,
  };
}

/** The generator that makes pictures or video: one with the user's own key if there is one, else Focus's free one. */
function generatorAgent(ctx: Ctx, kind: "image" | "video"): Agent | undefined {
  const ready = ctx.state.agents.filter((a) => a.kind === kind && a.enabled && !missing(ctx.state, a));
  return ready.find((a) => connectionOf(ctx.state, a)?.provider !== "focus") ?? ready[0];
}

/** Focus chats run one assistant per tier; it is made on the fly and never listed on the Agents page. */
function tierAgent(ctx: Ctx, tier: Tier, think = 0): Agent {
  let conn = ctx.state.connections.find((c) => c.provider === "focus");
  if (!conn) {
    conn = newConnection("focus");
    ctx.state.connections.unshift(conn);
    ctx.persist();
  }
  const t = TIERS[tier];
  // skills switched on in Settings apply to every Focus chat
  const global = allSkills(ctx.state).filter((k) => ctx.state.settings.skills.includes(k.id) && k.instructions.trim()).map((k) => `Skill — ${k.name}: ${k.instructions.trim()}`);
  // what the user told Focus about themselves in Settings → Account
  const me = displayUser();
  const about = me ? profileOf(me.id).about?.trim() : "";
  if (me) global.push(`The user's name is ${me.name}.${about ? ` About them, in their words: ${about}` : ""}`);
  return { id: `tier-${tier}`, name: t.name, connectionId: conn.id, kind: "chat", model: `tier:${tier}:${think}`, effort: "", role: [`${PERSONA}\n\n${t.role}`, ...global].join("\n\n"), color: TIER_COLORS[tier], enabled: true, skills: [], avatar: "", prefer: choiceModel(ctx.state.settings.focus) };
}

/* ---------- thinking ---------- */

/** The Focus mark with its wave running. */
function waveMark(size: number): SVGSVGElement {
  const mark = focusMark(size);
  mark.classList.add("wave");
  return mark;
}

/** The small waving logo shown while an answer is on its way. */
function thinkMark(): SVGSVGElement {
  const mark = waveMark(17);
  mark.classList.add("think-mark");
  return mark;
}

/** What Focus is "doing" while the first words are on their way. Half true, half not. */
const THINKING = [
  "Focusating…",
  "Using the browser…",
  "Digging in n8n and Zapier…",
  "Chatting with other AIs…",
  "Joining the terminal…",
  "Asking Claude what a CLI is…",
  "Reading the docs nobody reads…",
  "Consulting the rubber duck…",
  "Bribing the GPU with cookies…",
  "Arguing with Stack Overflow…",
  "Turning it off and on again…",
  "Herding tokens…",
  "Running npm install on my brain…",
  "git blame-ing the universe…",
  "Trying very hard not to hallucinate…",
  "sudo think --harder…",
  "Asking ChatGPT for a second opinion…",
  "Untangling the neurons…",
  "Checking the vibes…",
  "Waiting for the coffee to brew…",
  "Pretending this is easy…",
  "Counting to infinity. Twice…",
  "Sharpening pixels…",
  "Compiling a witty answer…",
  "Googling “how to be smart”…",
  "Warming up the hamster wheel…",
];

// one shuffle per visit, so the order surprises but labels don't repeat back to back
const thinkingOrder = THINKING.map((t) => [Math.random(), t] as const)
  .sort((a, b) => a[0] - b[0])
  .map(([, t]) => t);

/**
 * A label that changes every couple of seconds. It reads the clock rather than counting,
 * so a re-render mid-stream carries on where it was instead of starting over.
 */
function thinkingLabel(): HTMLSpanElement {
  const el = h("span", { class: "think-label" });
  const born = Date.now();
  const at = () => thinkingOrder[Math.floor(Date.now() / 2300) % thinkingOrder.length];
  el.textContent = at();
  const timer = setInterval(() => {
    if (!el.isConnected) {
      // not attached yet (first frame) or replaced by a newer render
      if (Date.now() - born > 1000) clearInterval(timer);
      return;
    }
    const next = at();
    if (next === el.textContent) return;
    el.textContent = next;
    el.classList.remove("swap-think");
    void el.offsetWidth;
    el.classList.add("swap-think");
  }, 400);
  return el;
}

/* ---------- messages ---------- */

/** The chat's ready agents, in the order of the Agents page. */
function teamOf(ctx: Ctx, config: ChatConfig): Agent[] {
  return ctx.state.agents.filter((a) => config.agentIds.includes(a.id) && isReady(ctx.state, a));
}

function leadOf(ctx: Ctx, config: ChatConfig, team: Agent[]): Agent | undefined {
  // in Solo you can talk to any agent; elsewhere the lead has to reason in text
  const thinkers = team.filter((a) => a.kind === "chat");
  const pool = config.mode === "solo" ? ctx.state.agents.filter((a) => isReady(ctx.state, a)) : thinkers.length ? thinkers : team;
  return pool.find((a) => a.id === config.leadId) ?? pool.find((a) => a.kind === "chat" && connectionOf(ctx.state, a)?.provider !== "webhook") ?? pool[0];
}

function stepTime(step: StepRecord): string {
  return seconds((step.endedAt ?? Date.now()) - step.startedAt);
}

/** One growing element per streaming answer, so each update only parses what is new. */
const streamEls = new Map<string, HTMLElement>();
function streamingEl(key: string, text: string, cls: string): HTMLElement {
  let el = streamEls.get(key);
  if (!el) streamEls.set(key, (el = h("div", { class: cls })));
  renderMarkdownStreaming(el, text);
  return el;
}

function markdownEl(text: string, cls = "md"): HTMLElement {
  const el = h("div", { class: cls });
  renderMarkdown(el, text);
  return el;
}

let connectionsRef: Ctx["state"]["connections"] = [];

const isImage = (url: string) => /^data:image\//.test(url) || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url) || /image\.pollinations\.ai/.test(url);

/** Shows a generated image or video; files that need the key load through /api/media. */
function mediaEl(url: string | undefined, alt: string): HTMLElement | null {
  if (!url || !/^(https?:|data:(image|video)\/|proxy:)/i.test(url)) return null;
  const download = (src: string) =>
    h("a", { class: "media-link", href: src, download: "", target: "_blank", rel: "noopener" }, icon("download", 14), "Download");
  if (url.startsWith("proxy:")) {
    const box = h("div", { class: "media-box" }, h("p", { class: "step-wait" }, h("span", { class: "spinner sm" }), " Loading the video…"));
    resolveMedia(url, connectionsRef).then(
      (src) => box.replaceChildren(h("video", { class: "media", src, controls: true, playsinline: true }), download(src)),
      (error: unknown) => box.replaceChildren(h("p", { class: "step-error" }, error instanceof Error ? error.message : String(error))),
    );
    return box;
  }
  const box = h("div", { class: "media-box" });
  if (isImage(url)) {
    const img = h("img", { class: "media", src: url, alt, loading: "lazy" });
    // the free image service is often busy at full size: smaller sizes and another model are tried in turn
    const variants = /image\.pollinations\.ai/.test(url)
      ? [url.replace(/width=\d+&height=\d+/, "width=768&height=768"), url.replace(/width=\d+&height=\d+/, "width=768&height=768").replace(/&model=[^&]*/, "") + "&model=turbo", url.replace(/width=\d+&height=\d+/, "width=512&height=512").replace(/&model=[^&]*/, "") + "&model=flux"]
      : [`${url}${url.includes("?") ? "&" : "?"}retry=1`];
    let tries = 0;
    img.addEventListener("error", () => {
      if (tries < variants.length) {
        const next = variants[tries++];
        setTimeout(() => (img.src = next), 1200);
      } else
        box.replaceChildren(
          h("p", { class: "step-error" }, "The picture didn't load. The free image service is busy right now."),
          h("button", { class: "link-btn", type: "button", onclick: () => ((tries = 0), box.replaceChildren(img, download(url)), (img.src = `${variants[0]}&again=${Date.now()}`)) }, "Try again"),
        );
    });
    box.append(img, download(url));
  } else box.append(h("video", { class: "media", src: url, controls: true, playsinline: true }), download(url));
  return box;
}

function copyButton(text: () => string, label = "Copy"): HTMLButtonElement {
  const btn = h("button", { class: "icon-btn sm", type: "button", title: label, "aria-label": label }, icon("copy", 16));
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text());
      btn.replaceChildren(icon("check", 16));
    } catch {
      btn.title = "Couldn't copy";
    }
    setTimeout(() => btn.replaceChildren(icon("copy", 16)), 1500);
  });
  return btn;
}

function stepEl(step: StepRecord, compact: boolean): HTMLElement {
  const body =
    step.status === "error"
      ? h("p", { class: "step-error" }, step.error ?? "Failed.")
      : step.text
        ? markdownEl(step.text, `md step-md${compact ? " clamp" : ""}`)
        : step.media
          ? h("span")
          : h("p", { class: "step-wait" }, step.progress ?? thinkingLabel());
  const el = h(
    "div",
    { class: `step ${step.status}` },
    h(
      "div",
      { class: "step-head" },
      step.status === "running" ? thinkMark() : agentAvatar("sm", step, step.provider),
      h("span", { class: "step-who" }, step.agentName),
      h("span", { class: "step-phase" }, step.phase),
      h("span", { class: "step-time" }, step.status === "error" ? "failed" : stepTime(step)),
    ),
    body,
    mediaEl(step.media, `Result from ${step.agentName}`),
  );
  if (compact && step.text.length > 600 && step.status !== "running") {
    el.append(
      h(
        "button",
        {
          class: "link-btn",
          type: "button",
          onclick: (e) => {
            el.querySelector(".clamp")?.classList.remove("clamp");
            (e.currentTarget as HTMLElement).remove();
          },
        },
        "Show more",
      ),
    );
  }
  return el;
}

function messageEl(ctx: Ctx, chat: Chat, m: Message): HTMLElement {
  if (m.role === "user") {
    return h(
      "div",
      { class: "msg user", "data-msg": m.id },
      m.attachments?.length
        ? h(
            "div",
            { class: "msg-files" },
            ...m.attachments.map((a) =>
              a.kind === "image" && a.data ? h("img", { class: "msg-image", src: dataUrlOf(a), alt: a.name }) : h("span", { class: "file-chip" }, icon("file", 14), h("span", { class: "chip-name" }, a.name)),
            ),
          )
        : null,
      h("div", { class: "bubble" }, m.content),
      h("div", { class: "msg-actions" }, copyButton(() => m.content)),
    );
  }

  const el = h("div", { class: "msg assistant", "data-msg": m.id });
  fillAssistant(ctx, chat, m, el);
  return el;
}

function fillAssistant(ctx: Ctx, chat: Chat, m: Message, el: HTMLElement): void {
  const mode = modeInfo(m.mode ?? "council");
  const steps = m.steps ?? [];
  const running = m.status === "running";
  const final = steps.find((s) => s.id === m.finalStepId);
  const names = [...new Map(steps.map((s) => [s.agentId, s])).values()];

  const head = h(
    "div",
    { class: "msg-head" },
    h("span", { class: "avatars" }, ...names.slice(0, 4).map((s) => agentAvatar("", s, s.provider))),
    h("span", { class: "msg-mode" }, icon(mode.icon, 15), mode.name),
    h("span", { class: "msg-team" }, names.map((s) => s.agentName).join(", ")),
  );

  const parts: (Node | null)[] = [head];
  const isSolo = m.mode === "solo";
  const isCompare = m.mode === "compare";
  if (running && !steps.length) parts.push(h("p", { class: "step-wait" }, thinkMark(), " ", thinkingLabel()));

  if (!isSolo && !isCompare && steps.length) {
    const active = steps.filter((s) => s.status === "running");
    const elapsed = seconds(((m.endedAt ?? Date.now()) - m.createdAt) || 0);
    const userOpen = processOpen.get(m.id);
    const details = h(
      "details",
      { class: "process", open: userOpen ?? running },
      h(
        "summary",
        {},
        running ? thinkMark() : icon("check", 15),
        h(
          "span",
          {},
          running
            ? active.length
              ? `${active.map((s) => s.agentName).join(", ")} ${active.length === 1 ? "is" : "are"} working on ${active.map((s) => s.phase.toLowerCase()).filter((v, i, a) => a.indexOf(v) === i).join(", ")}…`
              : "Working…"
            : `Worked for ${elapsed} · ${steps.length} step${steps.length === 1 ? "" : "s"}`,
        ),
        icon("chevron", 15),
      ),
      h("div", { class: "process-steps" }, ...steps.map((s) => stepEl(s, true))),
    );
    details.addEventListener("toggle", () => processOpen.set(m.id, details.open));
    parts.push(details);
  }

  if (isCompare) {
    parts.push(
      h(
        "div",
        { class: `compare cols-${Math.min(steps.length, 3)}` },
        ...steps.map((s) =>
          h(
            "div",
            { class: "compare-card" },
            stepEl(s, false),
            s.status === "done" ? h("div", { class: "msg-actions" }, copyButton(() => s.text)) : null,
          ),
        ),
      ),
    );
  } else if (isSolo && running && steps[0]) {
    parts.push(steps[0].text ? streamingEl(`${m.id}:${steps[0].id}`, steps[0].text, "md answer streaming") : h("p", { class: "step-wait" }, thinkMark(), " ", steps[0].progress ?? thinkingLabel()));
  } else if (final) {
    if (m.note) parts.push(h("p", { class: "note" }, m.note));
    parts.push(markdownEl(final.text, "md answer"), mediaEl(final.media, `Result from ${final.agentName}`));
  }

  if (m.status === "error" || (m.status === "done" && !final && !isCompare)) {
    const firstError = steps.find((s) => s.error)?.error;
    parts.push(h("div", { class: "msg-error" }, m.error ?? firstError ?? "No agent produced an answer."));
  }
  if (m.status === "stopped") parts.push(h("div", { class: "msg-stopped" }, "Stopped."));

  if (!running) {
    for (const k of streamEls.keys()) if (k.startsWith(`${m.id}:`)) streamEls.delete(k);
    const isLast = chat.messages.at(-1) === m;
    const usage = steps.reduce((n, s) => n + (s.usage ? s.usage.input + s.usage.output : 0), 0);
    parts.push(
      h(
        "div",
        { class: "msg-actions" },
        final ? copyButton(() => final.text) : null,
        isLast
          ? h("button", { class: "icon-btn sm", type: "button", title: "Run again", "aria-label": "Run again", onclick: () => regenerate(ctx, chat) }, icon("retry", 16))
          : null,
        h(
          "span",
          { class: "msg-meta" },
          [final ? `${final.agentName}${final.model ? ` · ${final.model}` : ""}` : "", usage ? `${usage.toLocaleString()} tokens` : "", m.endedAt ? seconds(m.endedAt - m.createdAt) : ""].filter(Boolean).join(" · "),
        ),
      ),
    );
  }
  el.replaceChildren(...parts.filter((p): p is Node => !!p));
}

let frame = 0;
const dirty = new Set<string>();

/** Re-renders a message on the next frame if its chat is on screen. */
let lastPaint = 0;

/**
 * Repaints changed messages on the next frame. Long streams (a whole game being written)
 * repaint less often, so re-rendering a big Markdown answer never eats every frame.
 */
const TOUCH = typeof matchMedia === "function" && matchMedia("(hover: none)").matches;

function refresh(chat: Chat, m: Message): void {
  dirty.add(m.id);
  if (frame) return;
  const size = (m.steps ?? []).reduce((n, s) => n + s.text.length, m.content.length);
  // phones repaint a streaming answer at most ~11 times a second: re-parsing Markdown on every chunk is what makes them lag
  const wait = size > 20000 ? 320 : size > 6000 ? 160 : TOUCH ? 90 : 0;
  const delay = Math.max(0, lastPaint + wait - performance.now());
  frame = window.setTimeout(() =>
    requestAnimationFrame(() => {
      frame = 0;
      lastPaint = performance.now();
      if (!view || view.chatId !== chat.id) return dirty.clear();
      const nearBottom = view.scroller.scrollHeight - view.scroller.scrollTop - view.scroller.clientHeight < 120;
      for (const id of dirty) {
        const el = view.list.querySelector<HTMLElement>(`[data-msg="${id}"]`);
        const msg = chat.messages.find((x) => x.id === id);
        if (el && msg) fillAssistant(view.ctx, chat, msg, el);
      }
      dirty.clear();
      if (nearBottom) view.scroller.scrollTop = view.scroller.scrollHeight;
    }),
  delay);
}

/* ---------- running a turn ---------- */

/** The message text with text attachments inlined; images are listed by name. */
function withAttachments(text: string, files: Attachment[] = [], imagesInline = false): string {
  return [
    text,
    ...files.map((f) =>
      f.kind === "image" ? (imagesInline ? "" : `[Image attached earlier: ${f.name}]`) : `---\nAttached file: ${f.name}\n\`\`\`\n${f.text ?? ""}\n\`\`\``,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}

const imagesOf = (m: Message): ImagePart[] =>
  (m.attachments ?? []).flatMap((a) => (a.kind === "image" && a.data && a.mediaType ? [{ mediaType: a.mediaType, data: a.data }] : []));

function historyBefore(chat: Chat, userMsg: Message): ChatTurn[] {
  const turns: ChatTurn[] = [];
  const msgs = chat.messages.slice(0, chat.messages.indexOf(userMsg));
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const next = msgs[i + 1];
    if (m.role === "user" && next?.role === "assistant" && next.content.trim()) {
      turns.push({ role: "user", content: withAttachments(m.content, m.attachments) }, { role: "assistant", content: next.content });
    }
  }
  // keep the most recent turns within budget
  let total = 0;
  let start = turns.length;
  while (start >= 2 && total + turns[start - 1].content.length + turns[start - 2].content.length < HISTORY_CHARS) {
    total += turns[start - 1].content.length + turns[start - 2].content.length;
    start -= 2;
  }
  return turns.slice(start);
}

const IMAGE_ASK = /(нарисуй|сгенерируй|создай|сделай|\bdraw\b|\bgenerate\b|\bcreate\b|\bmake\b)[^.!?]{0,40}(картинк|изображени|фото|рисунок|иллюстраци|логотип|постер|обои|\bimage\b|\bpicture\b|\bphoto\b|\blogo\b|illustration|poster|wallpaper)/i;

function mediaIntent(text: string): CreateKind | undefined {
  const t = text.slice(0, 600);
  if (detectBuild(t) === "clip") return "video";
  return IMAGE_ASK.test(t) ? "image" : undefined;
}

async function runTurn(ctx: Ctx, chat: Chat, userMsg: Message): Promise<void> {
  // Focus: one assistant per tier. Aeronus (and chats from before hubs existed): the whole team.
  const focusHub = chat.config.hub === "focus";
  const built = focusHub ? focusAgentOf(ctx, chat.config) : undefined;
  setToolsConfig(ctx.state.settings.tools);
  // in Aeronus a plain "make a video / draw a picture" goes to the generators without picking Create first
  const create = userMsg.create ?? (focusHub ? undefined : mediaIntent(userMsg.content));
  // pictures and video go to a generator; games, decks, sites and apps force the Builder on the chat model
  const media = create === "image" || create === "video" ? generatorAgent(ctx, create) : undefined;
  const base = built ? builtAgent(ctx, built) : focusHub ? tierAgent(ctx, chat.config.tier, chat.config.think ?? 0) : undefined;
  const tier = media ?? (base && create ? { ...base, create } : base);
  // Aeronus: the model chosen in Settings answers for every member that runs on Focus's own connection
  const hubModel = tier ? undefined : choiceModel(ctx.state.settings.aeronus);
  const withHubModel = (a: Agent): Agent => (hubModel && a.kind === "chat" && connectionOf(ctx.state, a)?.provider === "focus" ? { ...a, model: hubModel } : a);
  const team = tier ? [tier] : teamOf(ctx, chat.config).map(withHubModel);
  const lead0 = tier ? undefined : leadOf(ctx, chat.config, teamOf(ctx, chat.config));
  const lead = tier ?? (lead0 ? withHubModel(lead0) : undefined);
  const mode = focusHub || media ? "solo" : chat.config.mode;
  const agents = mode === "solo" && lead ? [lead] : team;
  const m: Message = { id: uid(), role: "assistant", content: "", mode, status: "running", steps: [], createdAt: Date.now() };
  chat.messages.push(m);
  chat.updatedAt = Date.now();
  ctx.persist();
  if (view?.chatId === chat.id) {
    view.list.append(messageEl(ctx, chat, m));
    view.scroller.scrollTop = view.scroller.scrollHeight;
  }

  if (!lead || !agents.length) {
    Object.assign(m, { status: "error", error: "No agent is ready. Pick agents in the team menu, or add a key in Connections.", endedAt: Date.now() });
    refresh(chat, m);
    ctx.persist();
    return;
  }

  const controller = new AbortController();
  runs.set(chat.id, controller);
  ctx.refreshSidebar();
  updateComposer(chat.id);

  const run = startRun({
    mode,
    task: withAttachments(userMsg.content, userMsg.attachments, true) || "Describe the attached image.",
    images: imagesOf(userMsg),
    history: historyBefore(chat, userMsg),
    agents,
    lead,
    rounds: chat.config.rounds,
    connectionOf: (a) => connectionOf(ctx.state, a)!,
    skills: allSkills(ctx.state),
    signal: controller.signal,
    onChange: () => refresh(chat, m),
  });
  m.steps = run.steps;

  try {
    const outcome = await run.done;
    m.finalStepId = outcome.final?.id;
    m.note = outcome.note;
    if (mode === "compare") {
      m.content = run.steps.filter((s) => s.status === "done").map((s) => `### ${s.agentName}\n${s.text}`).join("\n\n");
    } else {
      m.content = outcome.final?.text ?? "";
    }
    m.status = controller.signal.aborted ? "stopped" : m.content ? "done" : "error";
  } catch (error) {
    m.status = "error";
    m.error = error instanceof Error ? error.message : String(error);
  }
  m.endedAt = Date.now();
  m.steps = [...run.steps];
  runs.delete(chat.id);
  chat.updatedAt = Date.now();
  refresh(chat, m);
  ctx.persist();
  ctx.refreshSidebar();
  updateComposer(chat.id);
}

function send(ctx: Ctx, chat: Chat | undefined, text: string, create?: CreateKind): void {
  const attachments = pendingAttachments;
  pendingAttachments = [];
  if (!chat) {
    chat = {
      id: uid(),
      title: text.replace(/\s+/g, " ").slice(0, 60) || attachments[0]?.name || "New chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      config: draft ?? structuredClone(ctx.state.config),
      messages: [],
    };
    draft = undefined;
    ctx.state.chats.unshift(chat);
    const user: Message = { id: uid(), role: "user", content: text, attachments, create, createdAt: Date.now() };
    chat.messages.push(user);
    ctx.persist();
    ctx.go({ name: "chat", id: chat.id });
    void runTurn(ctx, chat, user);
    return;
  }
  const user: Message = { id: uid(), role: "user", content: text, attachments, create, createdAt: Date.now() };
  chat.messages.push(user);
  view?.list.append(messageEl(ctx, chat, user));
  void runTurn(ctx, chat, user);
}

function regenerate(ctx: Ctx, chat: Chat): void {
  if (runs.has(chat.id)) return;
  const last = chat.messages.at(-1);
  if (last?.role === "assistant") chat.messages.pop();
  const user = chat.messages.at(-1);
  if (user?.role !== "user") return;
  view?.list.querySelector(`[data-msg="${last?.id}"]`)?.remove();
  void runTurn(ctx, chat, user);
}

function exportChat(chat: Chat): void {
  const lines = [`# ${chat.title}`, ""];
  for (const m of chat.messages) {
    if (m.role === "user") lines.push(`## You`, "", withAttachments(m.content, m.attachments), "");
    else lines.push(`## Focus · ${modeInfo(m.mode ?? "council").name}`, "", m.note ? `> ${m.note}\n` : "", m.content || "_No answer._", "");
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `${chat.title.replace(/[^\w\- ]+/g, "").trim() || "chat"}.md` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- composer ---------- */

let composerState: { chatId?: string; sendBtn: HTMLButtonElement; input: HTMLTextAreaElement } | undefined;

function updateComposer(chatId: string): void {
  if (!composerState || composerState.chatId !== chatId) return;
  setSendButton(composerState.sendBtn, runs.has(chatId), !!composerState.input.value.trim() || pendingAttachments.length > 0);
}

function setSendButton(btn: HTMLButtonElement, running: boolean, hasText: boolean): void {
  btn.replaceChildren(icon(running ? "stop" : "up", 18));
  btn.title = running ? "Stop" : "Send";
  btn.setAttribute("aria-label", btn.title);
  btn.classList.toggle("stop", running);
  btn.disabled = !running && !hasText;
}

const fill = (el: HTMLElement, ...children: (Node | string | null | undefined)[]) => el.replaceChildren(...children.filter((c): c is Node | string => c != null));

let popover: HTMLElement | undefined;
function closePopover(): void {
  popover?.remove();
  popover = undefined;
}
document.addEventListener("click", (e) => {
  // composedPath still knows where the click went even if the target was re-rendered since
  if (popover && !e.composedPath().some((n) => n instanceof Element && n.matches(".popover, [data-popover]"))) closePopover();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePopover();
});

function openPopover(anchor: HTMLElement, content: HTMLElement): void {
  const same = popover?.dataset.for === anchor.dataset.popover;
  closePopover();
  if (same) return;
  popover = h("div", { class: "popover", role: "dialog", "data-for": anchor.dataset.popover ?? "" }, content);
  // lives at the app root, not inside the glass message box: glass can only blur
  // what's behind it when no glass ancestor is in the way
  const r = anchor.getBoundingClientRect();
  const left = Math.max(12, Math.min(r.left, innerWidth - 352));
  // open on the side with more room and never taller than that room, so every row can be scrolled to
  const view = window.visualViewport?.height ?? innerHeight;
  const below = view - r.bottom - 20;
  const above = r.top - 20;
  if (below >= 260 || below >= above) Object.assign(popover.style, { left: `${left}px`, top: `${r.bottom + 8}px`, maxHeight: `${Math.max(160, Math.min(520, below))}px` });
  else Object.assign(popover.style, { left: `${left}px`, bottom: `${view - r.top + 8}px`, maxHeight: `${Math.max(160, Math.min(520, above))}px` });
  anchor.closest(".app-root")!.append(popover);
  // keep the whole popover on screen, whatever its real width
  // offsetWidth ignores the opening scale animation, so this is the real size
  const w = Math.min(popover.offsetWidth, innerWidth - 24);
  popover.style.maxWidth = `${innerWidth - 24}px`;
  // on a phone the sheet sits in the middle, clear of both edges
  popover.style.left = `${innerWidth < 520 ? Math.round((innerWidth - w) / 2) : Math.max(12, Math.min(r.left, innerWidth - w - 12))}px`;
}

// a phone's address bar sliding away resizes the page; only a real change of width (a turned screen) closes the menu
let popoverWidth = innerWidth;
addEventListener("resize", () => {
  if (innerWidth !== popoverWidth) closePopover();
  popoverWidth = innerWidth;
});

/** The one-line note under the message box that follows whatever is selected. */
function captionFor(ctx: Ctx, config: ChatConfig, hub: Hub, fa?: FocusAgent): string {
  if (hub === "aeronus") return `Aeronus · ${modeInfo(config.mode).name}: ${modeInfo(config.mode).short}`;
  if (fa) return `${fa.name || "Your agent"} · your own agent`;
  const t = TIERS[config.tier];
  const level = config.think ? ` · ${THINK[config.think].name}` : "";
  return `${t.name} · ${t.tag}${level}`;
}

function buildComposer(ctx: Ctx, chat: Chat | undefined, config: ChatConfig, onHubChange?: () => void): HTMLElement {
  const input = h("textarea", { rows: 1, placeholder: "Message your team…", "aria-label": "Message" });
  const files = h("div", { class: "composer-files" });
  const caption = h("div", { class: "cap-line", "aria-live": "polite" });
  const sendBtn = h("button", { class: "send-btn", type: "button" });
  const fileInput = h("input", { type: "file", multiple: true, hidden: true, accept: ACCEPT });
  let reading = 0;
  composerState = { chatId: chat?.id, sendBtn, input };

  const sync = () => {
    input.style.height = "auto";
    if (input.scrollHeight) input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
    setSendButton(sendBtn, !!chat && runs.has(chat.id), reading === 0 && (!!input.value.trim() || pendingAttachments.length > 0));
    files.classList.toggle("reading", reading > 0);
  };

  const renderFiles = () =>
    files.replaceChildren(
      ...pendingAttachments.map((f, i) =>
        h(
          "span",
          { class: "file-chip" },
          f.kind === "image" && f.data ? h("img", { class: "chip-thumb", src: dataUrlOf(f), alt: "" }) : icon("file", 14),
          h("span", { class: "chip-name" }, f.name),
          h(
            "button",
            {
              type: "button",
              "aria-label": `Remove ${f.name}`,
              onclick: () => {
                pendingAttachments.splice(i, 1);
                renderFiles();
                sync();
              },
            },
            icon("close", 12),
          ),
        ),
      ),
    );

  const addFiles = async (list: Iterable<File>) => {
    const errors: string[] = [];
    for (const file of list) {
      if (pendingAttachments.length + reading >= 14) {
        errors.push("Up to 14 attachments per message.");
        break;
      }
      reading++;
      sync();
      try {
        pendingAttachments.push(...(await readAttachments(file)));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
      reading--;
      renderFiles();
      sync();
    }
    if (errors.length) alert(errors.join("\n"));
  };

  fileInput.addEventListener("change", async () => {
    await addFiles(fileInput.files ?? []);
    fileInput.value = "";
  });
  input.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    void addFiles(files);
  });

  // voice input: the browser's own speech recognition, in the interface language
  const Rec = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
  const micBtn = h("button", { class: "mic-btn", type: "button", title: "Voice input", "aria-label": "Voice input" }, icon("mic", 18));
  let rec: any;
  const stopVoice = () => {
    try {
      rec?.stop();
    } catch {
      /* already stopped */
    }
  };
  let wanted = false;
  let base = "";
  let finalText = "";
  const startVoice = () => {
    rec = new Rec!();
    rec.lang = getLang() === "ru" ? "ru-RU" : "en-US";
    rec.interimResults = true;
    // phones repeat words in continuous mode, so each phrase is its own session and the next one starts on end
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += (finalText && !/\s$/.test(finalText) ? " " : "") + r[0].transcript.trim();
        else interim += r[0].transcript;
      }
      input.value = base + finalText + (interim ? (finalText ? " " : "") + interim : "");
      sync();
    };
    rec.onerror = (e: any) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      wanted = false;
      if (e.error === "not-allowed") {
        alert(tr("Allow the microphone for this site to dictate. If Focus is open inside another page, open it in its own tab."));
        return;
      }
      // the browser has the API but no working speech service (common on Android browsers): record instead
      useRecorder();
    };
    rec.onend = () => {
      rec = undefined;
      if (wanted) {
        base = input.value ? input.value.replace(/\s*$/, " ") : "";
        finalText = "";
        try {
          startVoice();
          return;
        } catch {
          wanted = false;
        }
      }
      if (!recording) micBtn.classList.remove("on");
      sync();
    };
    let started = false;
    rec.onstart = () => (started = true);
    const current = rec;
    rec.start();
    // some browsers never start the recogniser and never say why: record instead
    setTimeout(() => {
      if (!started && rec === current && wanted) {
        wanted = false;
        stopVoice();
        useRecorder();
      }
    }, 4000);
  };

  // the fallback: record, then the server transcribes
  let recording: Recording | undefined;
  let transcribing = false;
  const prefersRecorder = () => {
    try {
      return localStorage.getItem("focus.voice") === "rec";
    } catch {
      return false;
    }
  };
  const useRecorder = () => {
    try {
      localStorage.setItem("focus.voice", "rec");
    } catch {
      // remembered for this visit only
    }
    void startRecorder();
  };
  const finishRecorder = async () => {
    const r = recording;
    if (!r) return;
    recording = undefined;
    transcribing = true;
    micBtn.classList.remove("on");
    micBtn.classList.add("busy");
    micBtn.title = tr("Recognising…");
    try {
      const text = (await r.finish()).trim();
      if (text) {
        input.value = (input.value ? input.value.replace(/\s*$/, " ") : "") + text;
        sync();
        input.focus();
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      transcribing = false;
      micBtn.classList.remove("busy");
      micBtn.title = tr("Voice input");
    }
  };
  const startRecorder = async () => {
    if (import.meta.env.VITE_ARTIFACT === "1") {
      alert(tr("Voice input works on the website: open focus-agents.vercel.app."));
      return;
    }
    if (!canRecord()) {
      alert(tr("Voice input isn't supported in this browser. Try Chrome, Edge or Safari."));
      return;
    }
    try {
      recording = await startRecording(() => void finishRecorder());
      micBtn.classList.add("on");
    } catch {
      recording = undefined;
      micBtn.classList.remove("on");
      alert(tr("Allow the microphone for this site to dictate. If Focus is open inside another page, open it in its own tab."));
    }
  };

  micBtn.addEventListener("click", () => {
    if (transcribing) return;
    if (recording) return void finishRecorder();
    if (wanted) {
      wanted = false;
      return stopVoice();
    }
    if (!Rec || prefersRecorder()) return void startRecorder();
    base = input.value ? input.value.replace(/\s*$/, " ") : "";
    finalText = "";
    wanted = true;
    try {
      startVoice();
      micBtn.classList.add("on");
    } catch {
      wanted = false;
      rec = undefined;
      useRecorder();
    }
  });

  const submit = () => {
    wanted = false;
    stopVoice();
    recording?.cancel();
    recording = undefined;
    if (chat && runs.has(chat.id)) {
      runs.get(chat.id)?.abort();
      return;
    }
    if (reading) return;
    const text = input.value.trim();
    if (!text && !pendingAttachments.length) return;
    input.value = "";
    renderFiles();
    sync();
    closePopover();
    const made = create;
    create = undefined;
    paintCreate();
    renderBar();
    send(ctx, chat, text, made);
    renderFiles();
  };

  input.addEventListener("input", sync);
  input.addEventListener("keydown", (e) => {
    if (!e.repeat && (e.key.length === 1 || e.key === "Backspace" || e.key === "Enter")) click(e.key === "Enter" ? 1.3 : 1);
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  sendBtn.addEventListener("click", submit);

  const bar = h("div", { class: "composer-bar" });

  // The hub switch and the tier picker live outside renderBar, so their thumbs slide instead of being rebuilt.
  const hubOption = (hub: Hub, label: string) =>
    h("button", { class: `hub-opt hub-${hub}`, type: "button", role: "radio", "data-hub": hub, onclick: () => setHub(hub) }, label);
  const hubSwitch = h(
    "div",
    { class: "hub-switch", role: "radiogroup", "aria-label": "Focus or Aeronus", "data-hub": hubOf(config) },
    h("span", { class: "hub-thumb", "aria-hidden": "true" }),
    hubOption("focus", "Focus"),
    hubOption("aeronus", "Aeronus"),
  );
  const tierOption = (tier: Tier) =>
    h("button", { class: `tier-opt tier-${tier}`, type: "button", role: "radio", "data-tier": tier, title: `${TIERS[tier].name} — ${TIERS[tier].blurb}`, onclick: () => setTier(tier) }, TIERS[tier].name);
  const tierSeg = h(
    "div",
    { class: "tier-seg", role: "radiogroup", "aria-label": "Focus tier", "data-tier": config.tier },
    h("span", { class: "tier-thumb", "aria-hidden": "true" }),
    ...TIER_ORDER.map(tierOption),
  );
  const opts = h("div", { class: "bar-opts" });

  // how hard Focus thinks: a slider behind a small chip
  let paintModelChip: (() => void) | undefined;
  const thinkChip = h("button", { class: "chip-btn think-chip", type: "button", "data-popover": "think", "aria-haspopup": "dialog", title: "How hard Focus thinks" });
  const paintThink = () => {
    const lvl = config.think ?? 0;
    thinkChip.dataset.level = String(lvl);
    thinkChip.replaceChildren(
      h("span", { class: "think-bars", "aria-hidden": "true" }, h("i"), h("i"), h("i")),
      h("span", { class: "think-long" }, THINK[lvl].name),
      h("span", { class: "think-short", "aria-hidden": "true" }, THINK[lvl].short ?? THINK[lvl].name),
    );
    thinkChip.setAttribute("aria-label", `Thinking: ${THINK[lvl].name}`);
    paintModelChip?.();
  };
  const thinkMenu = () => {
    const hint = h("p", { class: "think-hint" }, THINK[config.think ?? 0].hint);
    const range = h("input", { type: "range", min: 0, max: THINK.length - 1, step: 1, value: String(config.think ?? 0), class: "think-range", "aria-label": "Thinking level" });
    const marks = h("div", { class: "think-marks" }, ...THINK.map((t, i) => h("button", { type: "button", "data-i": String(i), onclick: () => set(i) }, t.short ?? t.name)));
    const set = (i: number) => {
      config.think = i;
      range.value = String(i);
      range.style.setProperty("--pn", String(i / (THINK.length - 1)));
      void handWrite(hint, THINK[i].hint);
      for (const b of marks.querySelectorAll<HTMLElement>("button")) b.classList.toggle("on", b.dataset.i === String(i));
      if (thinkChip.dataset.level === String(i)) return;
      ctx.state.config = structuredClone(config);
      ctx.persist();
      paintThink();
    };
    range.addEventListener("input", () => set(Number(range.value)));
    const menu = h("div", { class: "menu think-menu" }, h("div", { class: "menu-title" }, "Thinking"), range, marks, hint);
    set(config.think ?? 0);
    return menu;
  };
  thinkChip.addEventListener("click", (e) => openPopover(e.currentTarget as HTMLElement, thinkMenu()));
  paintThink();
  let shownHub: Hub | undefined;

  // who to talk to in Focus: Focus itself or one of the user's agents
  const agentMenu = () => {
    const pickAgent = (id: string | undefined) => {
      config.agentId = id;
      changed();
      applyHub(hubOf(config));
      onHubChange?.();
      closePopover();
    };
    const row = (id: string | undefined, art: Node, name: string, sub: string) =>
      h("button", { class: `menu-item${config.agentId === id ? " selected" : ""}`, type: "button", onclick: () => pickAgent(id) }, art, h("span", { class: "menu-text" }, h("strong", {}, name), h("small", {}, sub)), config.agentId === id ? icon("check", 16) : null);
    return h(
      "div",
      { class: "menu agent-menu" },
      h("div", { class: "menu-title" }, "Talk to"),
      row(undefined, focusMark(22), "Focus", "Storm, GEN or Clorus"),
      ...ctx.state.focusAgents.map((a) => row(a.id, agentMascot(a.color, 22), a.name || "Agent", a.model ? a.model.replace(/:free$/, " · free") : `Focus picks · ${TIERS[a.tier].name}`)),
      h(
        "a",
        {
          class: "menu-foot",
          href: "/app/my-agents",
          onclick: (e: Event) => {
            e.preventDefault();
            closePopover();
            ctx.go({ name: "builder" });
          },
        },
        ctx.state.focusAgents.length ? "Manage agents →" : "Build your own agent →",
      ),
    );
  };
  const agentChip = h("button", { class: "chip-btn agent-chip", type: "button", "data-popover": "agent", "aria-haspopup": "dialog", title: "Talk to Focus or one of your agents", onclick: (e: Event) => openPopover(e.currentTarget as HTMLElement, agentMenu()) });

  // the + menu: attach files, or ask Focus to make something
  let create: CreateKind | undefined;
  const createPill = h("div", { class: "create-pill", hidden: true });
  const paintCreate = () => {
    const c = CREATE.find((x) => x.kind === create);
    createPill.hidden = !c;
    createPill.replaceChildren(
      ...(c ? [icon(c.icon, 14), h("span", {}, `Create · ${c.name}`), h("button", { type: "button", "aria-label": "Cancel", onclick: () => ((create = undefined), paintCreate(), renderBar()) }, icon("close", 13))] : []),
    );
    createPill.classList.toggle("on", !!c);
  };
  setCreateRef = (k) => {
    create = k;
    paintCreate();
    renderBar();
    input.focus();
  };
  const plusMenu = () =>
    h(
      "div",
      { class: "menu plus-menu" },
      h("button", { class: "menu-item", type: "button", onclick: () => (closePopover(), fileInput.click()) }, icon("clip", 18), h("span", { class: "menu-text" }, h("strong", {}, "Attach files"), h("small", {}, "Photos, video, PDFs and text files"))),
      h("div", { class: "menu-title" }, "Create"),
      ...CREATE.filter((c) => hubOf(config) === "focus" || c.kind === "image" || c.kind === "video").map((c) =>
        h(
          "button",
          {
            class: `menu-item${create === c.kind ? " selected" : ""}`,
            type: "button",
            onclick: () => {
              create = create === c.kind ? undefined : c.kind;
              paintCreate();
              renderBar();
              closePopover();
              input.focus();
            },
          },
          icon(c.icon, 18),
          h("span", { class: "menu-text" }, h("strong", {}, c.name), h("small", {}, c.hint)),
          create === c.kind ? icon("check", 16) : null,
        ),
      ),
    );

  // one chip holds every choice (hub, agent, tier, thinking, team) so the composer stays quiet
  const modelChip = h("button", { class: "chip-btn model-chip", type: "button", "data-popover": "model", "aria-haspopup": "dialog", title: "Model and settings for this chat" });
  paintModelChip = () => {
    const hub = hubOf(config);
    const fa = hub === "focus" ? focusAgentOf(ctx, config) : undefined;
    if (hub === "focus") {
      const lvl = config.think ?? 0;
      modelChip.replaceChildren(
        fa ? agentMascot(fa.color, 16) : focusMark(15),
        h("span", { class: `model-chip-name${fa ? "" : ` tier-${config.tier}`}` }, fa ? fa.name || "Agent" : TIERS[config.tier].name),
        ...(!fa && lvl ? [h("span", { class: "model-chip-sub" }, THINK[lvl].short ?? THINK[lvl].name)] : []),
        icon("chevron", 13),
      );
    } else {
      const team = teamOf(ctx, config);
      const lead = leadOf(ctx, config, team);
      const shown = config.mode === "solo" ? (lead ? [lead] : []) : team;
      modelChip.replaceChildren(
        h("span", { class: "avatars" }, ...shown.slice(0, 3).map((a) => agentAvatar("xs", a, connectionOf(ctx.state, a)?.provider))),
        h("span", { class: "model-chip-name" }, modeInfo(config.mode).name),
        icon("chevron", 13),
      );
    }
  };
  const modelSheet = (): HTMLElement => {
    const hub = hubOf(config);
    const fa = hub === "focus" ? focusAgentOf(ctx, config) : undefined;
    const sheet = h("div", { class: "menu model-sheet" });
    if (ctx.state.settings.teamMode || hub === "aeronus") sheet.append(hubSwitch);
    if (hub === "focus") {
      // the agent list only shows up once the user has built an agent
      if (ctx.state.focusAgents.length) sheet.append(...agentMenu().childNodes);
      if (!fa) sheet.append(h("div", { class: "menu-title" }, "Model"), tierSeg, ...thinkMenu().childNodes);
    } else {
      sheet.append(
        ...modeMenu().childNodes,
        h(
          "button",
          { class: "menu-item", type: "button", onclick: () => openPopover(modelChip, teamMenu()) },
          icon("agents", 18),
          h("span", { class: "menu-text" }, h("strong", {}, "Team"), h("small", {}, "Choose who works on the task")),
          icon("chevron", 14),
        ),
      );
    }
    return sheet;
  };
  modelChip.addEventListener("click", () => openPopover(modelChip, modelSheet()));

  const renderBar = () => {
    const hub = hubOf(config);
    const fa = hub === "focus" ? focusAgentOf(ctx, config) : undefined;
    agentChip.replaceChildren(fa ? agentMascot(fa.color, 18) : focusMark(16), h("span", { class: "agent-chip-name" }, fa ? fa.name || "Agent" : "Focus"), icon("chevron", 13));
    agentChip.classList.toggle("is-agent", !!fa);
    const mode = modeInfo(config.mode);
    const team = teamOf(ctx, config);
    const lead = leadOf(ctx, config, team);
    const shown = config.mode === "solo" ? (lead ? [lead] : []) : team;
    hubSwitch.dataset.hub = hub;
    tierSeg.dataset.tier = config.tier;
    for (const b of hubSwitch.querySelectorAll<HTMLElement>(".hub-opt")) b.setAttribute("aria-checked", String(b.dataset.hub === hub));
    for (const b of tierSeg.querySelectorAll<HTMLElement>(".tier-opt")) b.setAttribute("aria-checked", String(b.dataset.tier === config.tier));
    void typePlaceholder(input, create ? CREATE.find((c) => c.kind === create)!.ask : hub === "focus" ? `Ask ${fa ? fa.name || "your agent" : TIERS[config.tier].name}…` : "Message your team…");
    void handWrite(caption, captionFor(ctx, config, hub, fa));
    opts.replaceChildren(
      ...(hub === "focus"
        ? fa
          ? [agentChip]
          : [agentChip, tierSeg]
        : [
            h(
              "button",
              { class: "chip-btn", type: "button", "data-popover": "mode", "aria-haspopup": "dialog", onclick: (e) => openPopover(e.currentTarget as HTMLElement, modeMenu()) },
              icon(mode.icon, 16),
              mode.name,
              icon("chevron", 14),
            ),
            h(
              "button",
              { class: "chip-btn", type: "button", "data-popover": "team", "aria-haspopup": "dialog", onclick: (e) => openPopover(e.currentTarget as HTMLElement, teamMenu()) },
              h("span", { class: "avatars" }, ...shown.slice(0, 4).map((a) => agentAvatar("xs", a, connectionOf(ctx.state, a)?.provider))),
              shown.length === 1 ? shown[0].name : shown.length ? `${shown.length} agents` : "No agents",
              icon("chevron", 14),
            ),
          ]),
    );
    if (shownHub && shownHub !== hub) {
      opts.classList.remove("swap");
      void opts.offsetWidth;
      opts.classList.add("swap");
    }
    shownHub = hub;
    paintModelChip();
    bar.replaceChildren(
      h("button", { class: "chip-btn icon-only", type: "button", "data-popover": "plus", "aria-haspopup": "dialog", title: "Attach files or create something", "aria-label": "Attach files or create", onclick: (e: Event) => openPopover(e.currentTarget as HTMLElement, plusMenu()) }, icon("plus")),
      modelChip,
      h("span", { class: "spacer" }),
      sendBtn,
    );
  };

  const setHub = (hub: Hub) => {
    if (hubOf(config) === hub) return;
    config.hub = hub;
    changed();
    applyHub(hub, true);
    onHubChange?.();
  };

  const setTier = (tier: Tier) => {
    if (config.tier === tier) return;
    config.tier = tier;
    changed();
    onHubChange?.();
  };

  const changed = () => {
    ctx.state.config = structuredClone(config);
    ctx.persist();
    renderBar();
  };

  const modeMenu = () =>
    h(
      "div",
      { class: "menu" },
      h("div", { class: "menu-title" }, "How the team works"),
      ...MODES.map((m) =>
        h(
          "button",
          {
            class: `menu-item${m.id === config.mode ? " selected" : ""}`,
            type: "button",
            onclick: () => {
              config.mode = m.id;
              changed();
              closePopover();
            },
          },
          icon(m.icon, 18),
          h("span", { class: "menu-text" }, h("strong", {}, m.name), h("small", {}, m.short)),
          m.id === config.mode ? icon("check", 16) : null,
        ),
      ),
      h(
        "a",
        {
          class: "menu-foot",
          href: "/app/modes",
          onclick: (e) => {
            e.preventDefault();
            closePopover();
            ctx.go({ name: "modes" });
          },
        },
        "About the modes →",
      ),
    );

  const teamMenu = (): HTMLElement => {
    const mode = modeInfo(config.mode);
    const solo = config.mode === "solo";
    const wrap = h("div", { class: "menu team-menu" });
    const render = () => {
      const team = teamOf(ctx, config);
      const lead = leadOf(ctx, config, team);
      fill(wrap,
        h("div", { class: "menu-title" }, solo ? "Chat with" : "Team"),
        ...ctx.state.agents.map((a) => {
          const problem = !a.enabled ? "turned off" : missing(ctx.state, a);
          const checked = solo ? lead?.id === a.id : config.agentIds.includes(a.id);
          return h(
            "label",
            { class: `team-row${problem ? " disabled" : ""}` },
            h("input", {
              type: solo ? "radio" : "checkbox",
              name: "team",
              checked,
              disabled: !!problem,
              onchange: () => {
                if (solo) config.leadId = a.id;
                else config.agentIds = checked ? config.agentIds.filter((id) => id !== a.id) : [...config.agentIds, a.id];
                changed();
                render();
              },
            }),
            agentAvatar("xs", a, connectionOf(ctx.state, a)?.provider),
            h(
              "span",
              { class: "team-name" },
              a.name,
              h("small", {}, problem ?? [a.kind === "chat" ? "" : KIND_LABEL[a.kind], a.model || PROVIDERS[connectionOf(ctx.state, a)?.provider ?? "custom"].label].filter(Boolean).join(" · ")),
            ),
          );
        }),
        !solo && mode.leadLabel && team.length
          ? h(
              "label",
              { class: "menu-field" },
              mode.leadLabel,
              h(
                "select",
                {
                  onchange: (e) => {
                    config.leadId = (e.target as HTMLSelectElement).value;
                    changed();
                  },
                },
                ...team.filter((a) => a.kind === "chat").map((a) => h("option", { value: a.id, selected: a.id === lead?.id }, a.name)),
              ),
            )
          : null,
        mode.rounds
          ? h(
              "label",
              { class: "menu-field" },
              "Rounds",
              h(
                "select",
                {
                  onchange: (e) => {
                    config.rounds = Number((e.target as HTMLSelectElement).value);
                    changed();
                  },
                },
                ...[1, 2, 3, 4].map((n) => h("option", { value: n, selected: n === config.rounds }, String(n))),
              ),
            )
          : null,
        config.mode === "relay" && team.length ? h("p", { class: "menu-hint" }, `Order: ${team.map((a) => a.name).join(" → ")}. Change it on the Agents page.`) : null,
        h(
          "a",
          {
            class: "menu-foot",
            href: "/app/agents",
            onclick: (e) => {
              e.preventDefault();
              closePopover();
              ctx.go({ name: "agents" });
            },
          },
          "Manage agents →",
        ),
      );
    };
    render();
    return wrap;
  };

  renderBar();
  sync();
  renderFiles();
  const composer = h("div", { class: "composer" }, createPill, files, micBtn, input, bar, fileInput);
  composer.addEventListener("dragover", (e) => {
    e.preventDefault();
    composer.classList.add("drop");
  });
  composer.addEventListener("dragleave", () => composer.classList.remove("drop"));
  composer.addEventListener("drop", (e) => {
    e.preventDefault();
    composer.classList.remove("drop");
    void addFiles(e.dataTransfer?.files ?? []);
  });
  return composer;
}
