export type Provider = "anthropic" | "openai" | "gemini" | "xai" | "custom" | "webhook";
export type Effort = "" | "low" | "medium" | "high" | "xhigh" | "max";
export type ModeId = "solo" | "compare" | "council" | "vote" | "debate" | "relay" | "review" | "planner";

/** A provider account: where calls go and the key they use. */
export interface Connection {
  id: string;
  provider: Provider;
  name: string;
  apiKey: string;
  baseUrl: string;
  /** Model ids loaded from the provider, offered as suggestions. */
  models: string[];
}

/** A team member: a model on a connection, with a name and a role. */
export interface Agent {
  id: string;
  name: string;
  connectionId: string;
  model: string;
  effort: Effort;
  role: string;
  color: string;
  enabled: boolean;
}

export interface ChatConfig {
  mode: ModeId;
  agentIds: string[];
  leadId: string;
  rounds: number;
}

export interface StepRecord {
  id: number;
  agentId: string;
  agentName: string;
  color: string;
  phase: string;
  status: "running" | "done" | "error";
  text: string;
  media?: string;
  error?: string;
  model?: string;
  usage?: { input: number; output: number };
  startedAt: number;
  endedAt?: number;
}

export interface Attachment {
  name: string;
  size: number;
  text: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  /** For assistant messages: the final answer, which later turns see as history. */
  content: string;
  attachments?: Attachment[];
  mode?: ModeId;
  status?: "running" | "done" | "error" | "stopped";
  error?: string;
  steps?: StepRecord[];
  /** Which step holds the final answer. */
  finalStepId?: number;
  /** A short note from the lead, e.g. why an answer won the vote. */
  note?: string;
  media?: string;
  createdAt: number;
  endedAt?: number;
}

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  config: ChatConfig;
  messages: Message[];
}

export interface State {
  connections: Connection[];
  agents: Agent[];
  chats: Chat[];
  /** The setup new chats start with. */
  config: ChatConfig;
  sidebarCollapsed: boolean;
}

export interface ProviderInfo {
  label: string;
  agentName: string;
  defaultModel: string;
  keyPlaceholder: string;
  keyUrl?: string;
  needsKey: boolean;
  needsUrl: boolean;
  urlPlaceholder?: string;
  hint?: string;
  color: string;
}

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  anthropic: {
    label: "Anthropic",
    agentName: "Claude",
    defaultModel: "claude-opus-5-5",
    keyPlaceholder: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
    needsKey: true,
    needsUrl: false,
    color: "#d97757",
  },
  openai: {
    label: "OpenAI",
    agentName: "GPT",
    defaultModel: "",
    keyPlaceholder: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
    needsKey: true,
    needsUrl: false,
    color: "#10a37f",
  },
  gemini: {
    label: "Google Gemini",
    agentName: "Gemini",
    defaultModel: "",
    keyPlaceholder: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
    needsKey: true,
    needsUrl: false,
    color: "#4285f4",
  },
  xai: {
    label: "xAI",
    agentName: "Grok",
    defaultModel: "",
    keyPlaceholder: "xai-…",
    keyUrl: "https://console.x.ai",
    needsKey: true,
    needsUrl: false,
    color: "#3a3a3c",
  },
  custom: {
    label: "OpenAI-compatible",
    agentName: "Custom model",
    defaultModel: "",
    keyPlaceholder: "API key (if the endpoint needs one)",
    needsKey: false,
    needsUrl: true,
    urlPlaceholder: "https://openrouter.ai/api/v1",
    hint: "Any endpoint that speaks the OpenAI chat API: OpenRouter, Together, Groq, DeepSeek, Mistral, a local server…",
    color: "#8e8e93",
  },
  webhook: {
    label: "HTTP agent",
    agentName: "Agent",
    defaultModel: "",
    keyPlaceholder: "Bearer token (optional)",
    needsKey: false,
    needsUrl: true,
    urlPlaceholder: "https://your-endpoint.example/run",
    hint: "Video generators and autonomous agents (Manus, Jules…) through an endpoint of your own.",
    color: "#af52de",
  },
};

export const COLORS = ["#d97757", "#10a37f", "#4285f4", "#3a3a3c", "#af52de", "#ff9f0a", "#ff375f", "#30b0c7", "#8e8e93"];

export const ROLE_PRESETS: { name: string; role: string }[] = [
  { name: "Researcher", role: "You are a careful researcher. Gather the relevant facts, note uncertainty, and cite where claims come from when you can." },
  { name: "Critic", role: "You are a sharp critic. Look for errors, weak arguments, missing cases and risks. Be specific and constructive." },
  { name: "Coder", role: "You are a senior software engineer. Write correct, idiomatic, well-structured code and explain key decisions briefly." },
  { name: "Writer", role: "You are a skilled writer. Write clearly and concisely, with a strong structure and a natural voice." },
  { name: "Fact-checker", role: "You are a fact-checker. Verify each claim, flag anything doubtful or unsupported, and correct mistakes." },
  { name: "Strategist", role: "You are a strategist. Think about goals, trade-offs, risks and next steps; be pragmatic." },
  { name: "Translator", role: "You are a professional translator. Preserve meaning, tone and formatting." },
];

const STORAGE_KEY = "focus.v2";
const LEGACY_KEY = "focus.harness.v1";
const MAX_CHATS = 200;

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function newConnection(provider: Provider): Connection {
  return { id: uid(), provider, name: PROVIDERS[provider].label, apiKey: "", baseUrl: "", models: [] };
}

export function newAgent(connection: Connection): Agent {
  const info = PROVIDERS[connection.provider];
  return {
    id: uid(),
    name: info.agentName,
    connectionId: connection.id,
    model: info.defaultModel,
    effort: connection.provider === "anthropic" ? "high" : "",
    role: "",
    color: info.color,
    enabled: true,
  };
}

function defaults(): State {
  const connections = (["anthropic", "openai", "gemini", "xai"] as Provider[]).map(newConnection);
  const agents = connections.map(newAgent);
  return {
    connections,
    agents,
    chats: [],
    config: { mode: "council", agentIds: agents.map((a) => a.id), leadId: agents[0].id, rounds: 2 },
    sidebarCollapsed: false,
  };
}

/** Brings settings from the first version (keys stored on each agent) into connections. */
function migrateLegacy(raw: string): State | null {
  try {
    const old = JSON.parse(raw) as { agents?: { name?: string; provider?: Provider; model?: string; apiKey?: string; baseUrl?: string; effort?: Effort; role?: string; enabled?: boolean }[] };
    if (!Array.isArray(old.agents) || !old.agents.length) return null;
    const state = defaults();
    state.agents = [];
    for (const a of old.agents) {
      const provider = a.provider && a.provider in PROVIDERS ? a.provider : "custom";
      let conn = state.connections.find((c) => c.provider === provider && (c.apiKey === (a.apiKey ?? "") || !c.apiKey) && c.baseUrl === (a.baseUrl ?? ""));
      if (!conn) {
        conn = newConnection(provider);
        state.connections.push(conn);
      }
      if (!conn.apiKey) conn.apiKey = a.apiKey ?? "";
      conn.baseUrl = a.baseUrl ?? conn.baseUrl;
      state.agents.push({ ...newAgent(conn), name: a.name || PROVIDERS[provider].agentName, model: a.model ?? "", effort: a.effort ?? "", role: a.role ?? "", enabled: a.enabled ?? true });
    }
    state.config.agentIds = state.agents.map((a) => a.id);
    state.config.leadId = state.agents[0].id;
    return state;
  } catch {
    return null;
  }
}

export function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<State>;
      const base = defaults();
      const state: State = { ...base, ...saved, config: { ...base.config, ...saved.config } };
      // a reload during a run leaves it unfinished
      for (const chat of state.chats) {
        for (const m of chat.messages) {
          if (m.status === "running") {
            m.status = "stopped";
            m.steps?.forEach((s) => s.status === "running" && Object.assign(s, { status: "error", error: "Interrupted." }));
          }
        }
      }
      return state;
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    const migrated = legacy && migrateLegacy(legacy);
    if (migrated) return migrated;
  } catch {
    // storage blocked or corrupted: start fresh
  }
  return defaults();
}

export function save(state: State): void {
  state.chats.sort((a, b) => b.updatedAt - a.updatedAt);
  if (state.chats.length > MAX_CHATS) state.chats.length = MAX_CHATS;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return;
    } catch {
      // over quota: let go of the oldest chat and try again
      if (state.chats.length <= 1) return;
      state.chats.pop();
    }
  }
}

/* ---------- helpers ---------- */

export function connectionOf(state: State, agent: Agent): Connection | undefined {
  return state.connections.find((c) => c.id === agent.connectionId);
}

/** Why an agent can't run yet, or null when it's ready. */
export function missing(state: State, agent: Agent): string | null {
  const conn = connectionOf(state, agent);
  if (!conn) return "no connection";
  const info = PROVIDERS[conn.provider];
  if (info.needsUrl && !conn.baseUrl.trim()) return "needs URL";
  if (info.needsKey && !conn.apiKey.trim()) return "needs key";
  if (conn.provider !== "webhook" && !agent.model.trim()) return "needs model";
  return null;
}

export const isReady = (state: State, agent: Agent) => agent.enabled && !missing(state, agent);
