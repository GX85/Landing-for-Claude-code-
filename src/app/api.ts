import { detectBuild, runBuild, type BuildCall, type BuildKind } from "./builder";
import { PROVIDERS, TIERS, type Agent, type AgentKind, type Connection, type Tier } from "./store";

export interface ImagePart {
  mediaType: string;
  data: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  images?: ImagePart[];
}

export interface CallResult {
  text: string;
  model?: string;
  media?: string;
  usage?: { input: number; output: number };
}

function agentPayload(agent: Agent, conn: Connection) {
  return { provider: conn.provider, kind: agent.kind, model: agent.model, apiKey: conn.apiKey, baseUrl: conn.baseUrl, effort: agent.effort };
}

async function errorFrom(res: Response): Promise<Error> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(data.error || `Request failed (${res.status}).`);
}

const ollamaBase = (conn: Connection) => (conn.baseUrl.trim() || PROVIDERS.ollama.urlPlaceholder!).replace(/\/+$/, "");

/** Reads an OpenAI-style SSE stream and returns the full text. */
async function readSse(res: Response, onText: (full: string) => void): Promise<{ text: string; model?: string }> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let text = "";
  let model: string | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return { text, model };
      const chunk = JSON.parse(payload) as { model?: string; choices?: { delta?: { content?: string } }[] };
      model = chunk.model ?? model;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        onText(text);
      }
    }
  }
  return { text, model };
}

/** Ollama runs on the user's computer, so the browser talks to it directly. */
async function callOllama(agent: Agent, conn: Connection, system: string, messages: ChatTurn[], signal: AbortSignal, onText: (full: string) => void): Promise<CallResult> {
  let res: Response;
  try {
    res = await fetch(`${ollamaBase(conn)}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: agent.model,
        stream: true,
        messages: [
          { role: "system", content: system },
          ...messages.map((m) =>
            m.images?.length
              ? { role: m.role, content: [{ type: "text", text: m.content }, ...m.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mediaType};base64,${i.data}` } }))] }
              : { role: m.role, content: m.content },
          ),
        ],
      }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(`Can't reach Ollama at ${ollamaBase(conn)}. Is it running, and started with OLLAMA_ORIGINS=* ?`);
  }
  if (!res.ok) throw new Error(`Ollama answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { text, model } = await readSse(res, onText);
  return { text: text.trim(), model: model ?? agent.model };
}

const FREE_URLS: Record<string, string> = {
  llm7: "https://api.llm7.io/v1/chat/completions",
  pollinations: "https://text.pollinations.ai/openai",
};

/** Hides `<think>` reasoning that some free models put in their answer. */
const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").replace(/^\s+/, "");

/**
 * Free Focus models without a key run straight from the browser, so each
 * visitor gets their own fair-use quota. Falling back to other models is the
 * caller's job (see chainCall).
 */
async function callFree(model: string, system: string, messages: ChatTurn[], signal: AbortSignal, onText: (full: string) => void, maxTokens = 8000): Promise<CallResult> {
  const body = (id: string) =>
    JSON.stringify({
      model: id,
      stream: true,
      // LLM7 counts the requested maximum against a small daily quota per visitor, so only
      // Pollinations is told a size; LLM7 uses its own default and the Builder continues cut-off code
      ...(model.startsWith("pollinations/") ? { max_tokens: maxTokens } : {}),
      messages: [
        { role: "system", content: system },
        ...messages.map((m) => ({ role: m.role, content: m.images?.length ? `${m.content}\n\n[An image was attached, but this free model can't see images.]` : m.content })),
      ],
    });
  const attempt = async (full: string): Promise<CallResult> => {
    const [host, ...rest] = full.split("/");
    const id = rest.join("/");
    const res = await fetch(FREE_URLS[host], { method: "POST", headers: { "content-type": "application/json" }, body: body(id), signal });
    if (!res.ok || !res.body) {
      const detail = (await res.text().catch(() => "")).slice(0, 400);
      if (/quota/i.test(detail)) exhausted.add(host);
      throw new Error(/quota/i.test(detail) ? "today's free quota on this server is used up" : res.status === 429 ? "the free server is busy (rate limit)" : `the free model answered ${res.status}`);
    }
    const { text } = await readSse(res, (t) => onText(stripThinking(t)));
    const clean = stripThinking(text).trim();
    if (!clean) throw new Error("The free model sent an empty answer.");
    return { text: clean, model: id };
  };
  return attempt(model);
}

/** Free hosts that said today's quota is used up; their other models are skipped for this visit. */
const exhausted = new Set<string>();

const GREET_KEY = "focus.greetings";

/**
 * A fresh one-line headline for the empty chat, written by a fast free model.
 * Resolves to null when no model answers in time; the caller keeps its own line then.
 */
export async function generateGreeting(hub: "focus" | "aeronus"): Promise<string | null> {
  if (import.meta.env.VITE_ARTIFACT === "1") return null;
  const ru = navigator.language.toLowerCase().startsWith("ru");
  let recent: string[] = [];
  try {
    recent = JSON.parse(localStorage.getItem(GREET_KEY) ?? "[]") as string[];
  } catch {
    // no history yet
  }
  const hour = new Date().getHours();
  const time = hour < 5 ? "deep night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const what = hub === "focus" ? "Focus, a sharp, witty AI assistant" : "Aeronus, a hub where a whole team of AI agents works on one task";
  const system = `You write the one headline on the empty start screen of ${what}. Write ONE fresh line of 2 to 7 words in ${ru ? "Russian" : "English"} that invites the user to start. Clever, warm, a little cheeky; vary the form (a question, a quip, an invitation, a tiny joke). It is ${time} for the user. No quotes, no hashtags, at most one emoji, nothing generic like "How can I help you?". Reply with the line only.`;
  const user = `A new one, please.${recent.length ? ` Not like these: ${recent.slice(0, 6).join(" | ")}` : ""}`;
  for (const [url, model] of [
    [FREE_URLS.llm7, "mistral-Nemo-Instruct-2407"],
    [FREE_URLS.pollinations, "openai-fast"],
  ]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, temperature: 1.05, max_tokens: 40, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const line = stripThinking(data.choices?.[0]?.message?.content ?? "")
        .split("\n")
        .map((l) => l.trim())
        .find(Boolean)
        ?.replace(/^["'«“#*\s]+|["'»”*\s]+$/g, "");
      if (!line || line.length < 3 || line.length > 70) continue;
      try {
        localStorage.setItem(GREET_KEY, JSON.stringify([line, ...recent].slice(0, 10)));
      } catch {
        // storage full or blocked: only the no-repeat memory is lost
      }
      return line;
    } catch {
      // try the next free model
    }
  }
  return null;
}

let userConnections: Connection[] = [];
/** Lets Focus agents borrow the user's own OpenRouter key for OpenRouter models. */
export const setConnections = (list: Connection[]) => (userConnections = list);

type Sample = ((input: string | { role: string; content: string }[], opts?: { onText?: (e: { text: string }) => void; signal?: AbortSignal; cache?: boolean }) => Promise<{ text: string }>) | null;
let samplePromise: Promise<Sample> | undefined;

/** Inside a Claude Artifact there is no Focus server, so every chat agent answers through Claude. */
async function callInArtifact(agent: Agent, system: string, messages: ChatTurn[], signal: AbortSignal, onText: (full: string) => void): Promise<CallResult> {
  const claude = (window as unknown as { claude?: { use: (n: string) => Promise<Sample> } }).claude;
  samplePromise ??= claude ? claude.use("sample") : Promise.resolve(null);
  const sample = await samplePromise;
  if (!sample) throw new Error("Claude isn't available in this view. Open the artifact on claude.ai while signed in.");
  const turns = messages.map((m, i) => ({
    role: m.role,
    content: `${i === 0 ? `${system}\n\n---\n\n` : ""}${m.content}${m.images?.length ? "\n\n[An image was attached.]" : ""}`,
  }));
  try {
    const r = await sample(turns, { onText: (e) => onText(e.text), signal, cache: false });
    return { text: r.text.trim(), model: `Claude · as ${agent.name}` };
  } catch (error) {
    const e = error as { code?: string; message?: string };
    throw new Error(e.code === "not_granted" ? "Allow this page to ask Claude to chat here." : e.code === "rate_limited" ? "Claude is rate limited right now. Try again in a minute." : e.message || "Claude couldn't answer.");
  }
}

let serverOpenRouter: boolean | undefined;
let orPausedUntil = 0;

/** A Focus tier: tries its OpenRouter models, then keyless free ones, until one answers. */
const shortModel = (m: string) => (m.startsWith("server/") ? "free model" : m.replace(/^(openrouter|llm7|pollinations)\//, "").replace(/^[\w-]+\//, "").replace(/:free$/, ""));

/** Fastest first: used when Focus only needs a quick answer. */
const SPEED_RANK = ["pollinations/openai-fast", "llm7/mistral-Nemo-Instruct-2407", "llm7/nemotron-3-nano:30b", "llm7/gpt-oss:20b", "llm7/minimax-m2.7"];
const speedOf = (m: string) => (SPEED_RANK.indexOf(m) + 1 || 50) + (m.startsWith("openrouter/") ? 20 : 0);

/**
 * Tries each model in turn until one answers; returns which one did.
 * A model that sends nothing for `firstTokenMs` is dropped for the next one,
 * so one stuck server can't keep the user waiting for minutes.
 */
async function chainCall(
  models: string[],
  agent: Agent,
  conn: Connection,
  system: string,
  messages: ChatTurn[],
  signal: AbortSignal,
  onText: (full: string) => void,
  opts: { maxTokens?: number; firstTokenMs?: number; totalMs?: number } = {},
): Promise<CallResult & { used: string }> {
  const own = userConnections.some((c) => c.provider === "openrouter" && c.apiKey);
  let last: unknown;
  for (const model of models) {
    if (model.startsWith("openrouter/") && ((!own && serverOpenRouter === false) || Date.now() < orPausedUntil)) continue;
    if (exhausted.has(model.split("/")[0])) continue;
    const attempt = new AbortController();
    const stop = () => attempt.abort();
    signal.addEventListener("abort", stop, { once: true });
    let heard = false;
    const firstTimer = setTimeout(() => !heard && attempt.abort(), opts.firstTokenMs ?? 20000);
    const totalTimer = setTimeout(stop, opts.totalMs ?? 180000);
    try {
      onText("");
      // "server/…" goes through Focus's own server, for when the browser can't reach the free hosts
      const r = await callAgent({ ...agent, model: model.startsWith("server/") ? "server" : model }, conn, system, messages, attempt.signal, (t) => {
        heard = true;
        onText(t);
      }, { maxTokens: opts.maxTokens });
      return { ...r, used: model };
    } catch (error) {
      if (signal.aborted) throw error;
      last = attempt.signal.aborted ? new Error(heard ? "the model stopped mid-answer" : "the model took too long to start") : error;
      const msg = String((error as Error).message);
      // the server has no OpenRouter key: stop asking it for the rest of this visit
      if (model.startsWith("openrouter/") && !own && /FOCUS_OPENROUTER_KEY|needs Focus/.test(msg)) serverOpenRouter = false;
      // OpenRouter's free models are rate limited per key: give them a few minutes off
      if (model.startsWith("openrouter/") && /429|rate.?limit|quota|credits|busy/i.test(msg)) orPausedUntil = Date.now() + 5 * 60_000;
    } finally {
      clearTimeout(firstTimer);
      clearTimeout(totalTimer);
      signal.removeEventListener("abort", stop);
    }
  }
  const why = last instanceof Error ? last.message : "";
  throw new Error(`No free model answered right now${why ? ` (${why.replace(/\.$/, "")})` : ""}. Wait a minute and try again, or add your own key in Connections.`);
}

const tierModels = (tier: Tier) => {
  const t = TIERS[tier];
  const own = userConnections.some((c) => c.provider === "openrouter" && c.apiKey);
  return [...(own || serverOpenRouter !== false ? t.or.slice(0, 2).map((m) => `openrouter/${m}`) : []), ...t.free, "server/openai-fast"];
};

/* ---------- thinking level ---------- */

/** 0 = auto (Focus decides per message), 1 = quick, 2 = thoughtful, 3 = deep, 4 = UltraVision. */
export type ThinkLevel = 0 | 1 | 2 | 3 | 4;

const SMALL_TALK = /^(привет|прив|здравствуй|здравствуйте|хай|ку|йо|hi|hey|hello|yo|sup|спасибо|спс|thanks|thank you|thx|ок|окей|ok|okay|пока|bye|как дела|как ты|how are you|what's up|доброе утро|добрый (день|вечер)|good (morning|evening|night))[\s!?.,)]*$/i;
const HARD = /(```|докажи|prove|почему|why|объясни|explain|сравни|compare|проанализ|analy[sz]|план|plan|стратеги|strategy|рассчитай|calculate|реши|solve|алгоритм|algorithm|архитектур|architecture|debug|отладь|ошибк|error|оптимиз|optimi[sz]|пошагово|step by step)/i;

/** How hard to think about this message when the level is Auto. */
function autoLevel(text: string): 1 | 2 | 3 {
  const t = text.trim();
  if (detectBuild(t)) return 3;
  if (SMALL_TALK.test(t) || (t.length < 40 && !/\?/.test(t))) return 1;
  if (HARD.test(t) || t.length > 600) return 3;
  return 2;
}

const LEVEL = {
  1: { name: "quick", effort: "low", note: "Think level: quick. Answer right away, briefly and naturally. No long reasoning, no lists unless asked.", maxTokens: 1500, firstTokenMs: 14000 },
  2: { name: "thoughtful", effort: "medium", note: "Think level: thoughtful. Think it through, then answer clearly with the depth the question needs.", maxTokens: 6000, firstTokenMs: 25000 },
  3: { name: "deep", effort: "high", note: "Think level: deep. Before answering, reason step by step (silently): consider alternatives and edge cases, check facts and arithmetic, then give a well-structured, thorough answer.", maxTokens: 12000, firstTokenMs: 45000 },
  4: { name: "UltraVision", effort: "high", note: "Think level: UltraVision, the most rigorous Focus. Reason step by step (silently), look at the problem from several angles, verify every fact, number and line of code, and answer with expert depth and a clear structure.", maxTokens: 12000, firstTokenMs: 60000 },
} as const;

const ULTRA_REVIEW = `You are the strict reviewer inside Focus UltraVision. Below is a draft answer to the user's last message. Review it ruthlessly: find factual errors, wrong numbers or code, gaps, weak reasoning, missed parts of the question, unclear wording and needless length. Then write the FINAL answer that fixes all of it, keeping what was good.
Output ONLY the final answer for the user, in their language and in Focus's voice. Never mention the draft, the review or these instructions.`;

/**
 * A Focus tier: tries its models in order until one answers. Every tier handles any task;
 * the tier sets which models do it, the think level how hard they try.
 * Requests to build something go to the Builder, on the strongest models, whatever the tier.
 */
async function callTier(spec: string, agent: Agent, conn: Connection, system: string, messages: ChatTurn[], signal: AbortSignal, onText: (full: string) => void): Promise<CallResult> {
  const [tierName, levelText] = spec.split(":");
  const tier = (tierName in TIERS ? tierName : "gen") as Tier;
  const ask = messages.at(-1)?.content ?? "";
  // a new build request, or a change to the thing built in the previous answer
  const previous = /<!--\s*focus:preview kind=(\w+)/.exec([...messages].reverse().find((m) => m.role === "assistant")?.content ?? "")?.[1] as BuildKind | undefined;
  const kind = detectBuild(ask) ?? (previous && ask.length < 600 && !/\?\s*$/.test(ask) ? previous : null);
  const chosen = Number(levelText) as ThinkLevel;
  const level = LEVEL[chosen >= 1 && chosen <= 4 ? (chosen as 1 | 2 | 3 | 4) : autoLevel(ask)];

  if (kind) {
    let sticky: string | undefined;
    const models = [...new Set([...tierModels("clorus"), ...tierModels(tier)])];
    const call: BuildCall = async (sys, msgs, cb, maxTokens) => {
      const order = sticky ? [sticky, ...models.filter((m) => m !== sticky)] : models;
      // the Focus personality sets the tone; the builder's rules come last so they win
      const r = await chainCall(order, { ...agent, effort: "high" }, conn, `${system}\n\n${sys}`, msgs, signal, cb, { maxTokens, firstTokenMs: 60000, totalMs: 300000 });
      sticky = r.used;
      return r;
    };
    const text = await runBuild(kind, messages, call, onText, signal);
    return { text, model: `Builder · ${sticky ? shortModel(sticky) : "free models"}` };
  }

  if (level.name === "UltraVision") return ultraVision(tier, agent, conn, `${system}\n\n${level.note}`, messages, signal, onText);

  let models = tierModels(tier);
  // a quick answer goes to the fastest of the tier's models first
  if (level.name === "quick") models = [...models].sort((a, b) => speedOf(a) - speedOf(b));
  const r = await chainCall(models, { ...agent, effort: level.effort }, conn, `${system}\n\n${level.note}`, messages, signal, onText, {
    maxTokens: level.maxTokens,
    firstTokenMs: level.firstTokenMs,
  });
  return { ...r, model: `${shortModel(r.used)} · ${level.name}` };
}

/**
 * UltraVision: the strongest models write a draft, then a second pass reviews it like a strict
 * editor and rewrites it. Twice the time, noticeably fewer mistakes.
 */
async function ultraVision(tier: Tier, agent: Agent, conn: Connection, system: string, messages: ChatTurn[], signal: AbortSignal, onText: (full: string) => void): Promise<CallResult> {
  const models = [...new Set([...tierModels("clorus"), ...tierModels(tier)])];
  const opts = { maxTokens: 12000, firstTokenMs: 60000, totalMs: 240000 };
  const deep = { ...agent, effort: "high" as const };
  const ru = /[а-яё]/i.test(messages.at(-1)?.content ?? "");
  const label = (en: string, rus: string) => `*UltraVision · ${ru ? rus : en}*`;

  onText(label("drafting…", "пишу черновик…"));
  const draft = await chainCall(models, deep, conn, system, messages, signal, (t) => onText(`${label("drafting…", "пишу черновик…")}\n\n${t}`), opts);

  onText(label("reviewing and rewriting…", "проверяю и переписываю…"));
  const order = [draft.used, ...models.filter((m) => m !== draft.used)];
  try {
    const final = await chainCall(
      order,
      deep,
      conn,
      `${system}\n\n${ULTRA_REVIEW}`,
      [...messages, { role: "assistant", content: draft.text }, { role: "user", content: "Review the draft above and reply with the final answer only." }],
      signal,
      (t) => onText(t || label("reviewing and rewriting…", "проверяю и переписываю…")),
      opts,
    );
    return { ...final, model: `${shortModel(final.used)} · UltraVision` };
  } catch (error) {
    // the review failed: the draft is still a good answer
    if (signal.aborted) throw error;
    return { ...draft, model: `${shortModel(draft.used)} · UltraVision (draft)` };
  }
}

/** Calls one chat agent and streams its text into `onText`. */
export async function callAgent(
  agent: Agent,
  conn: Connection,
  system: string,
  messages: ChatTurn[],
  signal: AbortSignal,
  onText: (full: string) => void,
  opts: { maxTokens?: number } = {},
): Promise<CallResult> {
  if (agent.model.startsWith("tier:")) return callTier(agent.model.slice(5), agent, conn, system, messages, signal, onText);
  if (import.meta.env.VITE_ARTIFACT === "1") return callInArtifact(agent, system, messages, signal, onText);
  if (conn.provider === "ollama") return callOllama(agent, conn, system, messages, signal, onText);
  if (conn.provider === "focus" && agent.model.startsWith("openrouter/")) {
    const own = userConnections.find((c) => c.provider === "openrouter" && c.apiKey);
    if (own) return callAgent({ ...agent, model: agent.model.slice("openrouter/".length) }, own, system, messages, signal, onText, opts);
  }
  if (conn.provider === "focus" && agent.kind === "chat" && /^(llm7|pollinations)\//.test(agent.model)) return callFree(agent.model, system, messages, signal, onText, opts.maxTokens);

  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent: agentPayload(agent, conn), system, messages }),
    signal,
  });
  if (!res.ok || !res.body) throw await errorFrom(res);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line) as { type: string; text?: string; error?: string } & CallResult;
      if (event.type === "delta" && event.text) {
        text += event.text;
        onText(text);
      } else if (event.type === "done") {
        return { text: event.text, model: event.model, media: event.media, usage: event.usage };
      } else if (event.type === "error") {
        throw new Error(event.error || "The call failed.");
      }
    }
  }
  throw new Error(signal.aborted ? "Stopped." : "The connection closed before the answer finished.");
}

interface JobResponse {
  status: "running" | "done" | "error";
  job?: { id: string; extra?: Record<string, string> };
  text?: string;
  media?: string;
  progress?: string;
  error?: string;
}

const POLL_MS = 4000;
const JOB_LIMIT_MS = 45 * 60_000;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("Stopped", "AbortError"))), { once: true });
  });

/** Runs a media or agent job: starts it, then polls until it finishes. */
export async function runJob(agent: Agent, conn: Connection, prompt: string, images: ImagePart[], signal: AbortSignal, onProgress: (status: string) => void): Promise<CallResult> {
  const post = async (body: object): Promise<JobResponse> => {
    const res = await fetch("/api/job", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent: agentPayload(agent, conn), ...body }), signal });
    if (!res.ok) throw await errorFrom(res);
    return (await res.json()) as JobResponse;
  };
  const started = Date.now();
  let r = await post({ action: "start", prompt, images });
  while (r.status === "running") {
    if (Date.now() - started > JOB_LIMIT_MS) throw new Error("Gave up waiting after 45 minutes; the job may still finish at the provider.");
    if (r.progress) onProgress(r.progress);
    await wait(POLL_MS, signal);
    r = await post({ action: "poll", job: r.job });
  }
  if (r.status === "error") throw new Error(r.error || "The job failed.");
  return { text: r.text ?? "", media: r.media, model: agent.model || undefined };
}

export async function fetchModels(conn: Connection, kind: AgentKind = "chat"): Promise<string[]> {
  if (conn.provider === "ollama") {
    let res: Response;
    try {
      res = await fetch(`${ollamaBase(conn)}/api/tags`);
    } catch {
      throw new Error(`Can't reach Ollama at ${ollamaBase(conn)}. Is it running, and started with OLLAMA_ORIGINS=* ?`);
    }
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  }
  const res = await fetch("/api/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent: { provider: conn.provider, kind, apiKey: conn.apiKey, baseUrl: conn.baseUrl } }),
  });
  const data = (await res.json().catch(() => ({}))) as { models?: string[]; error?: string };
  if (!res.ok || !data.models) throw new Error(data.error || "Couldn't load models.");
  return data.models;
}

const mediaCache = new Map<string, Promise<string>>();

/** Turns a `proxy:<provider>:<url>` result into a playable blob URL, fetched with the key. */
export function resolveMedia(media: string, connections: Connection[]): Promise<string> {
  const m = /^proxy:(\w+):(.+)$/.exec(media);
  if (!m) return Promise.resolve(media);
  const cached = mediaCache.get(media);
  if (cached) return cached;
  const conn = connections.find((c) => c.provider === m[1] && c.apiKey);
  const promise = (async () => {
    if (!conn) throw new Error("The connection for this file is gone.");
    const res = await fetch("/api/media", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: { provider: conn.provider, apiKey: conn.apiKey }, url: m[2] }),
    });
    if (!res.ok) throw await errorFrom(res);
    return URL.createObjectURL(await res.blob());
  })();
  mediaCache.set(media, promise);
  promise.catch(() => mediaCache.delete(media));
  return promise;
}
