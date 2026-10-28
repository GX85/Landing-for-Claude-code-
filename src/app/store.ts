export type Provider = "anthropic" | "openai" | "gemini" | "xai" | "custom" | "webhook";
export type Effort = "" | "low" | "medium" | "high" | "xhigh" | "max";
export type Mode = "council" | "relay" | "review";

export interface Agent {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl: string;
  effort: Effort;
  role: string;
  enabled: boolean;
}

export interface Settings {
  agents: Agent[];
  mode: Mode;
  leadId: string;
  rounds: number;
  task: string;
}

export interface ProviderInfo {
  label: string;
  defaultName: string;
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
    defaultName: "Claude",
    defaultModel: "claude-opus-5-5",
    keyPlaceholder: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
    needsKey: true,
    needsUrl: false,
    color: "#d97757",
  },
  openai: {
    label: "OpenAI",
    defaultName: "GPT",
    defaultModel: "",
    keyPlaceholder: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
    needsKey: true,
    needsUrl: false,
    color: "#10a37f",
  },
  gemini: {
    label: "Google Gemini",
    defaultName: "Gemini",
    defaultModel: "",
    keyPlaceholder: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
    needsKey: true,
    needsUrl: false,
    color: "#4285f4",
  },
  xai: {
    label: "xAI",
    defaultName: "Grok",
    defaultModel: "",
    keyPlaceholder: "xai-…",
    keyUrl: "https://console.x.ai",
    needsKey: true,
    needsUrl: false,
    color: "#1d1d1d",
  },
  custom: {
    label: "OpenAI-compatible",
    defaultName: "Custom model",
    defaultModel: "",
    keyPlaceholder: "API key (if the endpoint needs one)",
    needsKey: false,
    needsUrl: true,
    urlPlaceholder: "https://openrouter.ai/api/v1",
    hint: "Any endpoint that speaks the OpenAI chat API: OpenRouter, Together, Groq, DeepSeek, Mistral…",
    color: "#8e8e93",
  },
  webhook: {
    label: "HTTP agent",
    defaultName: "Agent",
    defaultModel: "",
    keyPlaceholder: "Bearer token (optional)",
    needsKey: false,
    needsUrl: true,
    urlPlaceholder: "https://your-endpoint.example/run",
    hint: "Video generators and autonomous agents (Manus, Jules…) through your own endpoint. Focus POSTs {task, system, model} and reads back text, or a video/image URL.",
    color: "#af52de",
  },
};

const STORAGE_KEY = "focus.harness.v1";

export function newAgent(provider: Provider): Agent {
  const info = PROVIDERS[provider];
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: info.defaultName,
    provider,
    model: info.defaultModel,
    apiKey: "",
    baseUrl: "",
    effort: provider === "anthropic" ? "high" : "",
    role: "",
    enabled: true,
  };
}

function defaults(): Settings {
  const agents = (["anthropic", "openai", "gemini", "xai"] as Provider[]).map(newAgent);
  return { agents, mode: "council", leadId: agents[0].id, rounds: 2, task: "" };
}

export function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      const base = defaults();
      return {
        ...base,
        ...saved,
        agents: Array.isArray(saved.agents) ? saved.agents.map((a) => ({ ...newAgent(a.provider ?? "custom"), ...a })) : base.agents,
      };
    }
  } catch {
    // storage blocked or corrupted: start fresh
  }
  return defaults();
}

export function save(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage blocked: settings live for this tab only
  }
}

/** Why an agent can't run yet, or null when it's ready. */
export function missing(agent: Agent): string | null {
  const info = PROVIDERS[agent.provider];
  if (info.needsUrl && !agent.baseUrl.trim()) return "needs URL";
  if (info.needsKey && !agent.apiKey.trim()) return "needs key";
  if (agent.provider !== "webhook" && !agent.model.trim()) return "needs model";
  return null;
}
