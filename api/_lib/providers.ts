import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { ApiError as GeminiApiError, GoogleGenAI } from "@google/genai";
import { listJobModels } from "./jobs.js";

export type Provider =
  | "focus"
  | "anthropic"
  | "openai"
  | "gemini"
  | "xai"
  | "openrouter"
  | "pollinations"
  | "custom"
  | "webhook"
  | "luma"
  | "replicate"
  | "manus"
  | "jules"
  | "devin";

export const PROVIDERS: readonly Provider[] = [
  "focus",
  "anthropic",
  "openai",
  "gemini",
  "xai",
  "openrouter",
  "pollinations",
  "custom",
  "webhook",
  "luma",
  "replicate",
  "manus",
  "jules",
  "devin",
];

export type AgentKind = "chat" | "image" | "video" | "agent";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentConfig {
  provider: Provider;
  model: string;
  apiKey: string;
  /** Base URL for OpenAI-compatible endpoints, or the endpoint URL for webhook agents. */
  baseUrl?: string;
  /** Claude only. */
  effort?: Effort;
  kind: AgentKind;
}

export interface ImagePart {
  mediaType: string;
  /** base64, no data: prefix */
  data: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  images?: ImagePart[];
}

export interface RunInput {
  agent: AgentConfig;
  system?: string;
  /** The conversation so far; the last message is the user's turn. */
  messages: ChatMessage[];
  signal?: AbortSignal;
  /** Called with each piece of streamed text. */
  onText?: (delta: string) => void;
}

export interface RunResult {
  text: string;
  model?: string;
  /** A media URL (video, image) returned by webhook agents such as video generators. */
  media?: string;
  usage?: { input: number; output: number };
}

/** An error whose message is safe to show to the user. */
export class UserError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 290_000;
const XAI_BASE_URL = "https://api.x.ai/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const POLLINATIONS_BASE_URL = "https://gen.pollinations.ai/v1";
const POLLINATIONS_FREE_URL = "https://text.pollinations.ai/openai";
/** The free model that works without any key. */
export const FOCUS_FREE_MODEL = "openai-fast";
const CLAUDE_MAX_TOKENS = 32000;
// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const CLAUDE_FALLBACK_MODELS = /^claude-(fable|mythos|opus|sonnet)-5/;
const TRUNCATED = "\n\n[Output cut at the token limit.]";

/* ---------- run ---------- */

export async function runAgent(input: RunInput): Promise<RunResult> {
  switch (input.agent.provider) {
    case "anthropic":
      return runClaude(input);
    case "openai":
    case "xai":
    case "openrouter":
    case "pollinations":
    case "custom":
      return runOpenAICompatible(input);
    case "focus":
      return runFocus(input);
    case "gemini":
      return runGemini(input);
    case "webhook":
      return runWebhook(input);
    default:
      throw new UserError("This agent makes media or runs tasks; it can't chat.");
  }
}

const imageNote = (m: ChatMessage) => (m.images?.length ? `\n\n[${m.images.length} image(s) attached — this model can't see images.]` : "");

/**
 * The built-in free model: Pollinations' anonymous tier (no key, fair-use limits).
 * When the server has its own Pollinations key (FOCUS_POLLINATIONS_KEY), Focus uses
 * that instead, which allows more models and higher limits.
 */
async function runFocus(input: RunInput): Promise<RunResult> {
  if (input.agent.model.startsWith("openrouter/")) {
    const orKey = process.env.FOCUS_OPENROUTER_KEY;
    if (!orKey) throw new UserError("This free model needs Focus's OpenRouter key on the server (FOCUS_OPENROUTER_KEY). Pick another free model.", 503);
    return runOpenAICompatible({ ...input, agent: { ...input.agent, provider: "openrouter", apiKey: orKey, model: input.agent.model.slice("openrouter/".length) } });
  }
  const key = process.env.FOCUS_POLLINATIONS_KEY;
  if (key) {
    return runOpenAICompatible({ ...input, agent: { ...input.agent, provider: "pollinations", apiKey: key, model: FOCUS_FREE_MODEL } });
  }
  const { system, messages, signal, onText } = input;
  const res = await fetch(POLLINATIONS_FREE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: FOCUS_FREE_MODEL,
      stream: true,
      messages: [...(system ? [{ role: "system", content: system }] : []), ...messages.map((m) => ({ role: m.role, content: m.content + imageNote(m) }))],
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) {
    throw new UserError(res.status === 429 ? "The free model is busy right now. Try again in a minute, or add your own key in Connections." : `The free model is unavailable (${res.status}). Try again shortly.`, res.status === 429 ? 429 : 502);
  }
  let text = "";
  let model = FOCUS_FREE_MODEL;
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload) as { model?: string; choices?: { delta?: { content?: string } }[] };
        model = data.model ?? model;
        const delta = data.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          onText?.(delta);
        }
      } catch {
        // keep-alive or partial line
      }
    }
  }
  if (!text.trim()) throw new UserError("The free model returned nothing. Try again.", 502);
  return { text: text.trim(), model };
}

async function runClaude({ agent, system, messages, signal, onText }: RunInput): Promise<RunResult> {
  const client = new Anthropic({ apiKey: agent.apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });
  const useFallbacks = CLAUDE_FALLBACK_MODELS.test(agent.model);

  const stream = client.beta.messages.stream(
    {
      model: agent.model,
      max_tokens: CLAUDE_MAX_TOKENS,
      ...(system ? { system } : {}),
      ...(agent.effort ? { output_config: { effort: agent.effort } } : {}),
      ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      messages: messages.map((m) =>
        m.role === "user" && m.images?.length
          ? {
              role: "user" as const,
              content: [
                ...m.images.map((i) => ({
                  type: "image" as const,
                  source: { type: "base64" as const, media_type: i.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp", data: i.data },
                })),
                { type: "text" as const, text: m.content },
              ],
            }
          : { role: m.role, content: m.content },
      ),
    },
    { signal },
  );
  stream.on("text", (delta) => onText?.(delta));
  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category;
    throw new UserError(`Claude declined this request${category ? ` (${category})` : ""}.`, 422);
  }

  // after a mid-stream fallback the next model continues the same text, so blocks join without a gap
  const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  return {
    text: text.trim() + (response.stop_reason === "max_tokens" ? TRUNCATED : ""),
    model: response.model,
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  };
}

const BASE_URLS: Partial<Record<Provider, string>> = {
  xai: XAI_BASE_URL,
  openrouter: OPENROUTER_BASE_URL,
  pollinations: POLLINATIONS_BASE_URL,
};

export function openAIClient(agent: AgentConfig): OpenAI {
  const baseURL = agent.provider === "custom" ? checkUrl(agent.baseUrl) : BASE_URLS[agent.provider];
  return new OpenAI({
    apiKey: agent.apiKey || "none",
    baseURL,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
    ...(agent.provider === "openrouter" ? { defaultHeaders: { "HTTP-Referer": "https://focus-agents.vercel.app", "X-Title": "Focus" } } : {}),
  });
}

type OpenAIContent = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

function openAIContent(m: ChatMessage): OpenAIContent {
  if (!m.images?.length || m.role !== "user") return m.content;
  return [{ type: "text", text: m.content }, ...m.images.map((i) => ({ type: "image_url" as const, image_url: { url: `data:${i.mediaType};base64,${i.data}` } }))];
}

/** Reasoning effort in each API's own words; Claude-only levels fold into "high". */
const plainEffort = (e?: Effort) => (!e ? undefined : e === "xhigh" || e === "max" ? "high" : e);
const GEMINI_BUDGET: Record<string, number> = { low: 1024, medium: 8192, high: 24576 };

/** Runs a call with the effort setting, and once more without it if the model rejects it. */
async function withEffort<T>(input: RunInput, call: (useEffort: boolean) => Promise<T>): Promise<T> {
  if (!input.agent.effort) return call(false);
  try {
    return await call(true);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 400 || status === 422) return call(false);
    throw error;
  }
}

function runOpenAICompatible(input: RunInput): Promise<RunResult> {
  return withEffort(input, (useEffort) => runOpenAICompatibleOnce(input, useEffort));
}

async function runOpenAICompatibleOnce({ agent, system, messages, signal, onText }: RunInput, useEffort: boolean): Promise<RunResult> {
  const effort = useEffort ? plainEffort(agent.effort) : undefined;
  const stream = await openAIClient(agent).chat.completions.create(
    {
      ...(effort ? (agent.provider === "openrouter" ? { reasoning: { effort } } : { reasoning_effort: effort as "low" | "medium" | "high" }) : {}),
      model: agent.model,
      messages: [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        ...messages.map((m) => (m.role === "user" ? { role: "user" as const, content: openAIContent(m) } : { role: "assistant" as const, content: m.content })),
      ],
      stream: true,
      // usage in the stream is an OpenAI extension that other endpoints may reject
      ...(agent.provider === "openai" ? { stream_options: { include_usage: true } } : {}),
    },
    { signal },
  );

  let text = "";
  let model = agent.model;
  let finish: string | null | undefined;
  let refusal = "";
  let usage: RunResult["usage"];
  for await (const chunk of stream) {
    model = chunk.model || model;
    if (chunk.usage) usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
    const choice = chunk.choices[0];
    if (!choice) continue;
    const delta = choice.delta?.content;
    if (delta) {
      text += delta;
      onText?.(delta);
    }
    if (choice.delta?.refusal) refusal += choice.delta.refusal;
    finish = choice.finish_reason ?? finish;
  }
  if (refusal && !text) throw new UserError(`The model declined: ${refusal}`, 422);
  return { text: text.trim() + (finish === "length" ? TRUNCATED : ""), model, usage };
}

function runGemini(input: RunInput): Promise<RunResult> {
  return withEffort(input, (useEffort) => runGeminiOnce(input, useEffort));
}

async function runGeminiOnce({ agent, system, messages, signal, onText }: RunInput, useEffort: boolean): Promise<RunResult> {
  const ai = new GoogleGenAI({ apiKey: agent.apiKey });
  const effort = useEffort ? plainEffort(agent.effort) : undefined;
  const stream = await ai.models.generateContentStream({
    model: agent.model,
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [...(m.images ?? []).map((i) => ({ inlineData: { mimeType: i.mediaType, data: i.data } })), { text: m.content }],
    })),
    config: {
      ...(system ? { systemInstruction: system } : {}),
      ...(effort ? { thinkingConfig: { thinkingBudget: GEMINI_BUDGET[effort] } } : {}),
      abortSignal: signal,
      httpOptions: { timeout: REQUEST_TIMEOUT_MS },
    },
  });

  let text = "";
  let model = agent.model;
  let finish: string | undefined;
  let blocked: string | undefined;
  let usage: RunResult["usage"];
  for await (const chunk of stream) {
    const delta = chunk.text;
    if (delta) {
      text += delta;
      onText?.(delta);
    }
    model = chunk.modelVersion ?? model;
    finish = chunk.candidates?.[0]?.finishReason ?? finish;
    blocked = chunk.promptFeedback?.blockReason ?? blocked;
    const meta = chunk.usageMetadata;
    if (meta) usage = { input: meta.promptTokenCount ?? 0, output: meta.candidatesTokenCount ?? 0 };
  }
  if (!text.trim()) throw new UserError(`Gemini returned no text${blocked || finish ? ` (${blocked ?? finish})` : ""}.`, 422);
  return { text: text.trim() + (finish === "MAX_TOKENS" ? TRUNCATED : ""), model, usage };
}

const MEDIA_URL = /^https?:\/\/\S+\.(mp4|webm|mov|png|jpe?g|gif|webp)(\?\S*)?$/i;

/**
 * A generic HTTP agent: POSTs `{ task, system, model, history }` as JSON and reads
 * back text or a media URL. Lets you plug in video generators and autonomous agents
 * through a small endpoint of your own.
 */
async function runWebhook({ agent, system, messages, signal }: RunInput): Promise<RunResult> {
  const url = checkUrl(agent.baseUrl);
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(agent.apiKey ? { authorization: `Bearer ${agent.apiKey}` } : {}),
    },
    body: JSON.stringify({
      task: messages.at(-1)?.content ?? "",
      system: system ?? "",
      model: agent.model || undefined,
      history: messages.slice(0, -1).map(({ role, content }) => ({ role, content })),
      images: (messages.at(-1)?.images ?? []).map((i) => `data:${i.mediaType};base64,${i.data}`),
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const raw = await res.text();
  if (!res.ok) throw new UserError(`Agent endpoint answered ${res.status}: ${raw.slice(0, 300)}`, 502);

  let text = raw.trim();
  let media: string | undefined;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data === "string") text = data;
    else if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      const pick = (...keys: string[]) => keys.map((k) => d[k]).find((v): v is string => typeof v === "string");
      text = pick("output", "text", "result", "message", "content") ?? JSON.stringify(data, null, 2);
      media = pick("video_url", "image_url", "media_url", "url");
    }
  } catch {
    // plain-text response
  }
  if (!media && MEDIA_URL.test(text)) media = text;
  return { text, media };
}

/* ---------- models ---------- */

interface PollinationsModel {
  id: string;
  category?: string;
  paid_only?: boolean;
}

/** Model ids the key can use, for the given kind of agent. Free models come first. */
export async function listModels(agent: AgentConfig): Promise<string[]> {
  const { provider, kind } = agent;
  switch (provider) {
    case "focus": {
      // the keyless models are listed in the browser; the server adds OpenRouter's free ones when it has a key
      if (kind !== "chat" || !process.env.FOCUS_OPENROUTER_KEY) return [];
      const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15_000) });
      const data = (await res.json()) as { data?: { id: string }[] };
      return (data.data ?? []).filter((m) => m.id.endsWith(":free")).map((m) => `openrouter/${m.id}`);
    }
    case "anthropic": {
      const client = new Anthropic({ apiKey: agent.apiKey, maxRetries: 1 });
      const ids: string[] = [];
      for await (const model of client.models.list()) ids.push(model.id);
      return ids;
    }
    case "pollinations": {
      const res = await fetch(`${POLLINATIONS_BASE_URL}/models`, { headers: agent.apiKey ? { authorization: `Bearer ${agent.apiKey}` } : {} });
      const data = (await res.json()) as { data?: PollinationsModel[] };
      const want = kind === "chat" ? "text" : kind;
      return (data.data ?? [])
        .filter((m) => m.category === want)
        .sort((a, b) => Number(!!a.paid_only) - Number(!!b.paid_only))
        .map((m) => m.id);
    }
    case "openai":
    case "xai":
    case "openrouter":
    case "custom": {
      const ids: string[] = [];
      for await (const model of openAIClient(agent).models.list()) ids.push(model.id);
      if (provider === "openai" && kind === "image") return ids.filter((id) => /image|dall-e/i.test(id));
      // free OpenRouter models first
      return ids.sort((a, b) => Number(!b.endsWith(":free")) - Number(!a.endsWith(":free")) || a.localeCompare(b));
    }
    case "gemini": {
      const ai = new GoogleGenAI({ apiKey: agent.apiKey });
      const ids: string[] = [];
      for await (const model of await ai.models.list()) {
        const id = model.name?.replace(/^models\//, "");
        const actions = model.supportedActions ?? [];
        if (!id) continue;
        if (kind === "video" ? /veo/i.test(id) : kind === "image" ? /imagen|image/i.test(id) : actions.includes("generateContent") && !/image|veo|imagen|tts|embedding/i.test(id)) ids.push(id);
      }
      return ids;
    }
    default:
      return listJobModels(agent);
  }
}

/* ---------- validation ---------- */

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|\[?f[cd][0-9a-f]{2}:.*|\[?fe80:.*)$/i;

/** Only public https endpoints may be called from the proxy. */
function checkUrl(value: string | undefined): string {
  if (!value) throw new UserError("This agent needs an endpoint URL.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UserError("The endpoint URL is not valid.");
  }
  const allowPrivate = process.env.FOCUS_ALLOW_PRIVATE_URLS === "1";
  if (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:")) {
    throw new UserError("The endpoint URL must start with https://.");
  }
  if (!allowPrivate && PRIVATE_HOST.test(url.hostname)) {
    throw new UserError("Private and local addresses can't be called from the Focus proxy.");
  }
  return url.toString().replace(/\/$/, "");
}

const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function parseAgent(value: unknown): AgentConfig {
  if (!value || typeof value !== "object") throw new UserError("Missing agent.");
  const a = value as Record<string, unknown>;
  const provider = str(a.provider) as Provider;
  if (!PROVIDERS.includes(provider)) throw new UserError("Unknown provider.");
  const effort = str(a.effort) as Effort;
  const kind = str(a.kind) as AgentKind;
  return {
    kind: ["chat", "image", "video", "agent"].includes(kind) ? kind : "chat",
    provider,
    model: str(a.model, 200),
    apiKey: str(a.apiKey, 500),
    baseUrl: str(a.baseUrl, 2000) || undefined,
    effort: ["low", "medium", "high", "xhigh", "max"].includes(effort) ? effort : undefined,
  };
}

const MAX_CONVERSATION_CHARS = 600_000;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function parseImages(value: unknown): ImagePart[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((i: unknown): ImagePart[] => {
      if (!i || typeof i !== "object") return [];
      const { mediaType, data } = i as Record<string, unknown>;
      if (typeof mediaType !== "string" || !IMAGE_TYPES.includes(mediaType) || typeof data !== "string") return [];
      if (!/^[A-Za-z0-9+/=]+$/.test(data) || data.length > 6_000_000) return [];
      return [{ mediaType, data }];
    })
    .slice(0, 8);
}

/** Accepts `messages` (a conversation) or a single `prompt`. */
export function parseMessages(body: Record<string, unknown>): ChatMessage[] {
  const list: ChatMessage[] = Array.isArray(body.messages)
    ? body.messages.flatMap((m: unknown): ChatMessage[] => {
        if (!m || typeof m !== "object") return [];
        const { role, content, images } = m as Record<string, unknown>;
        if ((role !== "user" && role !== "assistant") || typeof content !== "string") return [];
        const parts = role === "user" ? parseImages(images) : [];
        if (!content.trim() && !parts.length) return [];
        return [{ role, content: content.trim() ? content : "(see the attached image)", ...(parts.length ? { images: parts } : {}) }];
      })
    : typeof body.prompt === "string" && body.prompt.trim()
      ? [{ role: "user", content: body.prompt }]
      : [];
  while (list.length && list[0].role !== "user") list.shift();
  if (!list.length || list.at(-1)!.role !== "user") throw new UserError("The task is empty.");
  if (list.reduce((n, m) => n + m.content.length, 0) > MAX_CONVERSATION_CHARS) {
    throw new UserError("The conversation is too long. Start a new chat.");
  }
  return list;
}

/* ---------- http ---------- */

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** A short, user-facing description of a failure that never echoes request details. */
export function describeError(error: unknown): { message: string; status: number } {
  if (error instanceof UserError) return { message: error.message, status: error.status };
  if (error instanceof Anthropic.APIUserAbortError || (error instanceof Error && error.name === "AbortError")) {
    return { message: "Stopped.", status: 499 };
  }
  if (error instanceof Anthropic.APIError || error instanceof OpenAI.APIError || error instanceof GeminiApiError) {
    const status = error.status ?? 502;
    const hint =
      status === 401 || status === 403 || /API.?key/i.test(error.message)
        ? "The API key was rejected."
        : status === 404
          ? "Model or endpoint not found."
          : status === 429
            ? "Rate limited by the provider — try again shortly."
            : "";
    const detail = cleanMessage(providerMessage(error));
    return { message: [hint, detail].filter(Boolean).join(" "), status: status >= 400 && status < 600 ? status : 502 };
  }
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return { message: "The provider took too long to answer.", status: 504 };
    return { message: cleanMessage(error.message) || "The provider call failed.", status: 502 };
  }
  return { message: "The provider call failed.", status: 502 };
}

export function errorResponse(error: unknown): Response {
  const { message, status } = describeError(error);
  return json({ error: message }, status);
}

/** The provider's own error text, without the status line and raw JSON around it. */
function providerMessage(error: Error & { error?: unknown }): string {
  if (typeof error.error === "string") return error.error;
  let body = error.error as { message?: unknown; error?: { message?: unknown } } | undefined;
  if (!body) {
    // Gemini puts the JSON body into the message
    try {
      body = JSON.parse(error.message.slice(error.message.indexOf("{")));
    } catch {
      // not JSON
    }
  }
  const message = body?.error?.message ?? body?.message;
  return typeof message === "string" ? message : error.message;
}

function cleanMessage(message: string): string {
  // never reflect anything that looks like a key back to the browser
  return message.replace(/(sk|xai|AIza)[-_A-Za-z0-9]{8,}/g, "[key]").slice(0, 500);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (request.method !== "POST") throw new UserError("Use POST.", 405);
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object") return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new UserError("The request body must be JSON.");
}
