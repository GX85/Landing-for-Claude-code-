import type { Agent, Connection } from "./store";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface CallResult {
  text: string;
  model?: string;
  media?: string;
  usage?: { input: number; output: number };
}

function agentPayload(agent: Agent, conn: Connection) {
  return { provider: conn.provider, model: agent.model, apiKey: conn.apiKey, baseUrl: conn.baseUrl, effort: agent.effort };
}

/** Calls one agent through /api/run and streams its text into `onText`. */
export async function callAgent(
  agent: Agent,
  conn: Connection,
  system: string,
  messages: ChatTurn[],
  signal: AbortSignal,
  onText: (full: string) => void,
): Promise<CallResult> {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent: agentPayload(agent, conn), system, messages }),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Request failed (${res.status}).`);
  }

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

export async function fetchModels(conn: Connection): Promise<string[]> {
  const res = await fetch("/api/models", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent: { provider: conn.provider, apiKey: conn.apiKey, baseUrl: conn.baseUrl } }),
  });
  const data = (await res.json().catch(() => ({}))) as { models?: string[]; error?: string };
  if (!res.ok || !data.models) throw new Error(data.error || "Couldn't load models.");
  return data.models;
}
