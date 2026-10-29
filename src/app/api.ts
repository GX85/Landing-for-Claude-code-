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
 * visitor gets their own fair-use quota. If the chosen one fails, the
 * Pollinations model takes over.
 */
async function callFree(model: string, system: string, messages: ChatTurn[], signal: AbortSignal, onText: (full: string) => void): Promise<CallResult> {
  const body = (id: string) =>
    JSON.stringify({
      model: id,
      stream: true,
      messages: [
        { role: "system", content: system },
        ...messages.map((m) => ({ role: m.role, content: m.images?.length ? `${m.content}\n\n[An image was attached, but this free model can't see images.]` : m.content })),
      ],
    });
  const attempt = async (full: string): Promise<CallResult> => {
    const [host, ...rest] = full.split("/");
    const id = rest.join("/");
    const res = await fetch(FREE_URLS[host], { method: "POST", headers: { "content-type": "application/json" }, body: body(id), signal });
    if (!res.ok || !res.body) throw new Error(res.status === 429 ? "The free server is busy right now (rate limit)." : `The free model answered ${res.status}.`);
    const { text } = await readSse(res, (t) => onText(stripThinking(t)));
    const clean = stripThinking(text).trim();
    if (!clean) throw new Error("The free model sent an empty answer.");
    return { text: clean, model: id };
  };
  try {
    return await attempt(model);
  } catch (error) {
    const fallback = "pollinations/openai-fast";
    if (signal.aborted || model === fallback) throw error;
    onText("");
    return attempt(fallback);
  }
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

/** A Focus tier: tries its OpenRouter models, then keyless free ones, until one answers. */
async function callTier(tier: Tier, agent: Agent, conn: Connection, system: string, messages: ChatTurn[], signal: AbortSignal, onText: (full: string) => void): Promise<CallResult> {
  const t = TIERS[tier];
  const own = userConnections.some((c) => c.provider === "openrouter" && c.apiKey);
  const attempts = [...(own || serverOpenRouter !== false ? t.or.slice(0, 2).map((m) => `openrouter/${m}`) : []), ...t.free];
  let last: unknown;
  for (const model of attempts) {
    if (model.startsWith("openrouter/") && !own && serverOpenRouter === false) continue;
    try {
      onText("");
      const r = await callAgent({ ...agent, model }, conn, system, messages, signal, onText);
      return { ...r, model: `${model.replace(/^(openrouter|llm7|pollinations)\//, "").replace(/:free$/, "")}` };
    } catch (error) {
      if (signal.aborted) throw error;
      last = error;
      // the server has no OpenRouter key: stop asking it for the rest of this visit
      if (model.startsWith("openrouter/") && !own && /FOCUS_OPENROUTER_KEY|needs Focus/.test(String((error as Error).message))) serverOpenRouter = false;
    }
  }
  const why = last instanceof Error ? last.message : "";
  throw new Error(`No free model answered right now${why ? ` (${why.replace(/\.$/, "")})` : ""}. Wait a minute and try again, or add your own key in Connections.`);
}

/** Calls one chat agent and streams its text into `onText`. */
export async function callAgent(
  agent: Agent,
  conn: Connection,
  system: string,
  messages: ChatTurn[],
  signal: AbortSignal,
  onText: (full: string) => void,
): Promise<CallResult> {
  if (import.meta.env.VITE_ARTIFACT === "1") return callInArtifact(agent, system, messages, signal, onText);
  if (conn.provider === "ollama") return callOllama(agent, conn, system, messages, signal, onText);
  if (agent.model.startsWith("tier:")) return callTier(agent.model.slice(5) as Tier, agent, conn, system, messages, signal, onText);
  if (conn.provider === "focus" && agent.model.startsWith("openrouter/")) {
    const own = userConnections.find((c) => c.provider === "openrouter" && c.apiKey);
    if (own) return callAgent({ ...agent, model: agent.model.slice("openrouter/".length) }, own, system, messages, signal, onText);
  }
  if (conn.provider === "focus" && agent.kind === "chat" && /^(llm7|pollinations)\//.test(agent.model)) return callFree(agent.model, system, messages, signal, onText);

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
