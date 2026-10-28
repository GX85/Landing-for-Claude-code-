import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { ApiError as GeminiApiError, GoogleGenAI } from "@google/genai";

export type Provider = "anthropic" | "openai" | "gemini" | "xai" | "custom" | "webhook";

export const PROVIDERS: readonly Provider[] = ["anthropic", "openai", "gemini", "xai", "custom", "webhook"];

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentConfig {
  provider: Provider;
  model: string;
  apiKey: string;
  /** Base URL for OpenAI-compatible endpoints, or the endpoint URL for webhook agents. */
  baseUrl?: string;
  /** Claude only. */
  effort?: Effort;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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
    case "custom":
      return runOpenAICompatible(input);
    case "gemini":
      return runGemini(input);
    case "webhook":
      return runWebhook(input);
  }
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
      messages,
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

function openAIClient(agent: AgentConfig): OpenAI {
  const baseURL = agent.provider === "xai" ? XAI_BASE_URL : agent.provider === "custom" ? checkUrl(agent.baseUrl) : undefined;
  return new OpenAI({ apiKey: agent.apiKey || "none", baseURL, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });
}

async function runOpenAICompatible({ agent, system, messages, signal, onText }: RunInput): Promise<RunResult> {
  const stream = await openAIClient(agent).chat.completions.create(
    {
      model: agent.model,
      messages: [...(system ? [{ role: "system" as const, content: system }] : []), ...messages],
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

async function runGemini({ agent, system, messages, signal, onText }: RunInput): Promise<RunResult> {
  const ai = new GoogleGenAI({ apiKey: agent.apiKey });
  const stream = await ai.models.generateContentStream({
    model: agent.model,
    contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    config: {
      ...(system ? { systemInstruction: system } : {}),
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
      history: messages.slice(0, -1),
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

export async function listModels(agent: AgentConfig): Promise<string[]> {
  switch (agent.provider) {
    case "anthropic": {
      const client = new Anthropic({ apiKey: agent.apiKey, maxRetries: 1 });
      const ids: string[] = [];
      for await (const model of client.models.list()) ids.push(model.id);
      return ids;
    }
    case "openai":
    case "xai":
    case "custom": {
      const ids: string[] = [];
      for await (const model of openAIClient(agent).models.list()) ids.push(model.id);
      return ids.sort();
    }
    case "gemini": {
      const ai = new GoogleGenAI({ apiKey: agent.apiKey });
      const ids: string[] = [];
      for await (const model of await ai.models.list()) {
        if (model.name && (model.supportedActions ?? ["generateContent"]).includes("generateContent")) {
          ids.push(model.name.replace(/^models\//, ""));
        }
      }
      return ids;
    }
    case "webhook":
      return [];
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
  return {
    provider,
    model: str(a.model, 200),
    apiKey: str(a.apiKey, 500),
    baseUrl: str(a.baseUrl, 2000) || undefined,
    effort: ["low", "medium", "high", "xhigh", "max"].includes(effort) ? effort : undefined,
  };
}

const MAX_CONVERSATION_CHARS = 600_000;

/** Accepts `messages` (a conversation) or a single `prompt`. */
export function parseMessages(body: Record<string, unknown>): ChatMessage[] {
  const list: ChatMessage[] = Array.isArray(body.messages)
    ? body.messages.flatMap((m: unknown): ChatMessage[] => {
        if (!m || typeof m !== "object") return [];
        const { role, content } = m as Record<string, unknown>;
        if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim()) return [];
        return [{ role, content }];
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
