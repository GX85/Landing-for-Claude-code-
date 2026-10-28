import type { Ctx } from "./app";
import type { ChatTurn } from "./api";
import { h, icon, pageHead, seconds } from "./dom";
import { renderMarkdown } from "./markdown";
import { ACCEPT, dataUrlOf, readAttachment } from "./attachments";
import { resolveMedia, setConnections, type ImagePart } from "./api";
import { modeInfo, MODES, startRun } from "./modes";
import { click, setSound } from "./sound";
import { allSkills, avatarOf, connectionOf, isReady, KIND_LABEL, missing, PROVIDERS, uid, type Agent, type Attachment, type Chat, type ChatConfig, type Message, type StepRecord } from "./store";

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
  const config = chat?.config ?? (draft = structuredClone(ctx.state.config));
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

  const composer = buildComposer(ctx, chat, config);

  if (!chat || !chat.messages.length) {
    const ready = ctx.state.agents.some((a) => isReady(ctx.state, a));
    main.replaceChildren(
      head,
      h(
        "div",
        { class: "hello" },
        h(
          "div",
          { class: "hello-pill", "aria-hidden": "true" },
          h("video", { src: SCENE_VIDEO, poster: SCENE_POSTER, muted: true, loop: true, autoplay: true, playsinline: true, preload: "auto" }),
        ),
        h("h1", { class: "hello-title" }, "What should your team focus on?"),
        composer,
        ready
          ? h(
              "div",
              { class: "suggestions" },
              ...SUGGESTIONS.filter((s) => !s.kind || ctx.state.agents.some((a) => a.kind === s.kind && isReady(ctx.state, a))).slice(0, 4).map((s) =>
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
                      const input = main.querySelector<HTMLTextAreaElement>(".composer textarea");
                      if (input) {
                        input.value = s.text;
                        input.dispatchEvent(new Event("input"));
                        input.focus();
                      }
                    },
                  },
                  h("span", { class: "suggestion-mode" }, icon(s.kind ?? modeInfo(s.mode).icon, 15), s.kind ? "Image" : modeInfo(s.mode).name),
                  h("span", {}, s.text),
                ),
              ),
            )
          : h(
              "a",
              {
                class: "setup-hint",
                href: "/app/connections",
                onclick: (e) => {
                  e.preventDefault();
                  ctx.go({ name: "connections" });
                },
              },
              icon("key", 16),
              "Add an API key in Connections to start",
            ),
      ),
    );
    main.querySelector<HTMLVideoElement>(".hello-pill video")?.play().catch(() => undefined);
    return;
  }

  for (const m of chat.messages) list.append(messageEl(ctx, chat, m));
  main.replaceChildren(head, scroller, h("div", { class: "composer-dock" }, composer, h("p", { class: "disclaimer" }, "Agents can make mistakes. Check important info.")));
  requestAnimationFrame(() => (scroller.scrollTop = scroller.scrollHeight));
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
  return h(
    "div",
    { class: "media-box" },
    isImage(url) ? h("img", { class: "media", src: url, alt, loading: "lazy" }) : h("video", { class: "media", src: url, controls: true, playsinline: true }),
    download(url),
  );
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
          : h("p", { class: "step-wait" }, step.progress ?? "Thinking…");
  const el = h(
    "div",
    { class: `step ${step.status}` },
    h(
      "div",
      { class: "step-head" },
      step.status === "running" ? h("span", { class: "spinner sm" }) : h("span", { class: "avatar sm", style: `background:${step.color}` }, avatarOf(step)),
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
              a.kind === "image" && a.data ? h("img", { class: "msg-image", src: dataUrlOf(a), alt: a.name }) : h("span", { class: "file-chip" }, icon("file", 14), a.name),
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
    h("span", { class: "avatars" }, ...names.slice(0, 4).map((s) => h("span", { class: "avatar", style: `background:${s.color}`, title: s.agentName }, avatarOf(s)))),
    h("span", { class: "msg-mode" }, icon(mode.icon, 15), mode.name),
    h("span", { class: "msg-team" }, names.map((s) => s.agentName).join(", ")),
  );

  const parts: (Node | null)[] = [head];
  const isSolo = m.mode === "solo";
  const isCompare = m.mode === "compare";
  if (running && !steps.length) parts.push(h("p", { class: "step-wait" }, h("span", { class: "spinner sm" }), " Thinking…"));

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
        running ? h("span", { class: "spinner sm" }) : icon("check", 15),
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
    parts.push(steps[0].text ? markdownEl(steps[0].text, "md answer streaming") : h("p", { class: "step-wait" }, h("span", { class: "spinner sm" }), ` ${steps[0].progress ?? "Thinking…"}`));
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
function refresh(chat: Chat, m: Message): void {
  dirty.add(m.id);
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (!view || view.chatId !== chat.id) return dirty.clear();
    const nearBottom = view.scroller.scrollHeight - view.scroller.scrollTop - view.scroller.clientHeight < 120;
    for (const id of dirty) {
      const el = view.list.querySelector<HTMLElement>(`[data-msg="${id}"]`);
      const msg = chat.messages.find((x) => x.id === id);
      if (el && msg) fillAssistant(view.ctx, chat, msg, el);
    }
    dirty.clear();
    if (nearBottom) view.scroller.scrollTop = view.scroller.scrollHeight;
  });
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

async function runTurn(ctx: Ctx, chat: Chat, userMsg: Message): Promise<void> {
  const team = teamOf(ctx, chat.config);
  const lead = leadOf(ctx, chat.config, team);
  const agents = chat.config.mode === "solo" && lead ? [lead] : team;
  const m: Message = { id: uid(), role: "assistant", content: "", mode: chat.config.mode, status: "running", steps: [], createdAt: Date.now() };
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
    mode: chat.config.mode,
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
    if (chat.config.mode === "compare") {
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

function send(ctx: Ctx, chat: Chat | undefined, text: string): void {
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
    const user: Message = { id: uid(), role: "user", content: text, attachments, createdAt: Date.now() };
    chat.messages.push(user);
    ctx.persist();
    ctx.go({ name: "chat", id: chat.id });
    void runTurn(ctx, chat, user);
    return;
  }
  const user: Message = { id: uid(), role: "user", content: text, attachments, createdAt: Date.now() };
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
  if (popover && !(e.target as Element).closest(".popover, [data-popover]")) closePopover();
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
  if (r.top > innerHeight / 2) Object.assign(popover.style, { left: `${left}px`, bottom: `${innerHeight - r.top + 8}px` });
  else Object.assign(popover.style, { left: `${left}px`, top: `${r.bottom + 8}px` });
  anchor.closest(".app-root")!.append(popover);
}

addEventListener("resize", closePopover);

function buildComposer(ctx: Ctx, chat: Chat | undefined, config: ChatConfig): HTMLElement {
  const input = h("textarea", { rows: 1, placeholder: "Message your team…", "aria-label": "Message" });
  const files = h("div", { class: "composer-files" });
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
          f.name,
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
      if (pendingAttachments.length + reading >= 10) {
        errors.push("Up to 10 attachments per message.");
        break;
      }
      reading++;
      sync();
      try {
        pendingAttachments.push(await readAttachment(file));
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

  const submit = () => {
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
    send(ctx, chat, text);
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
  const renderBar = () => {
    const mode = modeInfo(config.mode);
    const team = teamOf(ctx, config);
    const lead = leadOf(ctx, config, team);
    const shown = config.mode === "solo" ? (lead ? [lead] : []) : team;
    bar.replaceChildren(
      h("button", { class: "chip-btn icon-only", type: "button", title: "Attach images, PDFs or text files", "aria-label": "Attach files", onclick: () => fileInput.click() }, icon("clip")),
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
        h("span", { class: "avatars" }, ...shown.slice(0, 4).map((a) => h("span", { class: "avatar xs", style: `background:${a.color}` }, avatarOf(a)))),
        shown.length === 1 ? shown[0].name : shown.length ? `${shown.length} agents` : "No agents",
        icon("chevron", 14),
      ),
      h("span", { class: "spacer" }),
      sendBtn,
    );
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
            h("span", { class: "avatar xs", style: `background:${a.color}` }, avatarOf(a)),
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
  const composer = h("div", { class: "composer" }, files, input, bar, fileInput);
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
