export type Provider =
  | "focus"
  | "anthropic"
  | "openai"
  | "gemini"
  | "xai"
  | "openrouter"
  | "ollama"
  | "pollinations"
  | "custom"
  | "webhook"
  | "luma"
  | "replicate"
  | "manus"
  | "jules"
  | "devin";
/** What an agent does: chats, makes images or videos, or runs tasks on its own. */
export type AgentKind = "chat" | "image" | "video" | "agent";
export type ProviderGroup = "free" | "chat" | "media" | "agents";
export type Effort = "" | "low" | "medium" | "high" | "xhigh" | "max";
export type ModeId = "solo" | "compare" | "council" | "vote" | "debate" | "relay" | "review" | "planner";

/** A provider account: where calls go and the key they use. */
export interface Connection {
  id: string;
  provider: Provider;
  name: string;
  apiKey: string;
  baseUrl: string;
  /** Chat model ids loaded from the provider, offered as suggestions. */
  models: string[];
  /** The same for image, video and agent models. */
  mediaModels?: Partial<Record<AgentKind, string[]>>;
}

export const modelsFor = (conn: Connection | undefined, kind: AgentKind): string[] =>
  !conn ? [] : kind === "chat" ? conn.models : (conn.mediaModels?.[kind] ?? []);

export function setModels(conn: Connection, kind: AgentKind, list: string[]): void {
  if (kind === "chat") conn.models = list;
  else conn.mediaModels = { ...conn.mediaModels, [kind]: list };
}

/** A team member: a model on a connection, with a name and a role. */
export interface Agent {
  id: string;
  name: string;
  connectionId: string;
  kind: AgentKind;
  model: string;
  effort: Effort;
  role: string;
  color: string;
  enabled: boolean;
  /** Ids of skills this agent uses. */
  skills: string[];
  /** One or two characters (or an emoji) shown in place of the initial. */
  avatar: string;
}

/** A reusable set of instructions that agents can be given. */
export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  builtIn?: boolean;
}

/** Free chat models that work with no key. Keyless ones run straight from the browser. */
export const FREE_MODELS: { id: string; label: string; note: string }[] = [
  { id: "llm7/nemotron-3-nano:30b", label: "NVIDIA Nemotron 3 Nano 30B", note: "Fast, good all-rounder" },
  { id: "llm7/minimax-m2.7", label: "MiniMax M2.7", note: "Reasons before answering" },
  { id: "llm7/mistral-Nemo-Instruct-2407", label: "Mistral Nemo 12B", note: "Quick and concise" },
  { id: "llm7/gpt-oss:20b", label: "GPT-OSS 20B", note: "OpenAI's open model" },
  { id: "llm7/codestral-latest", label: "Codestral", note: "Made for code" },
  { id: "pollinations/openai-fast", label: "GPT-OSS 20B · Pollinations", note: "A second free server" },
];

export const freeModelLabel = (id: string) => FREE_MODELS.find((m) => m.id === id)?.label ?? id.replace(/^openrouter\//, "").replace(/:free$/, " (free)");

/** What an agent's round badge shows: its avatar, or the first letter of its name. */
export const avatarOf = (a: { avatar?: string; name?: string; agentName?: string }) => [...(a.avatar?.trim() || a.name || a.agentName || "?")].slice(0, a.avatar?.trim() ? 2 : 1).join("");

export const allSkills = (state: { skills?: Skill[] }): Skill[] => [...BUILTIN_SKILLS.map((s) => ({ ...s, builtIn: true })), ...(state.skills ?? [])];

export const BUILTIN_SKILLS: Skill[] = [
  {
    id: "lang",
    name: "Match my language",
    description: "Always answers in the language you write in.",
    instructions: "Always reply in the same language the user writes in, even if earlier messages or attachments use another language.",
  },
  {
    id: "research",
    name: "Research brief",
    description: "Structured findings with sources and confidence.",
    instructions: "Structure answers as a research brief: a one-paragraph summary, key findings as bullets, then open questions. Say how confident you are in each finding and name sources when you know them. Never invent citations.",
  },
  {
    id: "code-review",
    name: "Code review",
    description: "Finds bugs, security issues and risky code first.",
    instructions: "When given code, review it like a senior engineer: list real bugs and security problems first (with the line or snippet), then risky patterns, then small improvements. Show fixed code for each important issue. Do not nitpick style unless asked.",
  },
  {
    id: "coder",
    name: "Production code",
    description: "Complete, runnable code with brief explanations.",
    instructions: "Write complete, runnable, idiomatic code with error handling. Prefer the standard library. Put code in fenced blocks with the language, and keep explanations short and after the code.",
  },
  {
    id: "copy",
    name: "Copywriting",
    description: "Punchy marketing copy with variants.",
    instructions: "Write clear, benefit-led marketing copy. Lead with the strongest idea, keep sentences short, avoid clichés, and offer three distinct variants when writing headlines or slogans.",
  },
  {
    id: "summarize",
    name: "Summaries",
    description: "TL;DR first, then the key points.",
    instructions: "Start with a one-sentence TL;DR in bold, then at most five key points as bullets, then any action items. Keep the original meaning; do not add facts.",
  },
  {
    id: "visual-prompt",
    name: "Visual prompts",
    description: "Turns ideas into prompts for image and video generators.",
    instructions: "When the result will go to an image or video generator, write a single vivid prompt: subject, setting, lighting, camera angle and lens, motion (for video), mood, style and colour palette. No more than 80 words, no lists, no explanations.",
  },
  {
    id: "teacher",
    name: "Explain simply",
    description: "Clear explanations with examples and analogies.",
    instructions: "Explain step by step in plain words, as to a smart beginner. Use one concrete example and one analogy, define any jargon, and end with a two-line recap.",
  },
  {
    id: "seo",
    name: "SEO",
    description: "Titles, meta descriptions and keywords.",
    instructions: "Optimise for search: suggest a title under 60 characters, a meta description under 155 characters, a primary keyword and 5 related keywords, and an H1/H2 outline. Keep it natural, never keyword-stuffed.",
  },
  {
    id: "fact-check",
    name: "Fact-check",
    description: "Checks each claim and flags doubtful ones.",
    instructions: "Check every factual claim in the text you are given. Mark each as correct, doubtful or wrong, explain briefly why, and give the corrected statement where needed.",
  },
];

export interface ChatConfig {
  mode: ModeId;
  agentIds: string[];
  leadId: string;
  rounds: number;
}

export interface StepRecord {
  avatar?: string;
  id: number;
  agentId: string;
  agentName: string;
  color: string;
  phase: string;
  status: "running" | "done" | "error";
  text: string;
  media?: string;
  /** Status line while a media or agent job runs. */
  progress?: string;
  error?: string;
  model?: string;
  usage?: { input: number; output: number };
  startedAt: number;
  endedAt?: number;
}

export interface Attachment {
  name: string;
  size: number;
  kind: "text" | "image";
  /** Text files and PDFs, as extracted text. */
  text?: string;
  /** Images, downscaled, as base64 without the data: prefix. */
  mediaType?: string;
  data?: string;
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
  /** Skills the user wrote; built-in ones live in BUILTIN_SKILLS. */
  skills: Skill[];
  /** Mechanical key clicks while typing and while answers stream. */
  sound: boolean;
  version?: number;
}

export interface ProviderInfo {
  label: string;
  group: ProviderGroup;
  agentName: string;
  kinds: AgentKind[];
  /** Default model per kind. */
  models: Partial<Record<AgentKind, string>>;
  keyPlaceholder: string;
  keyUrl?: string;
  needsKey: boolean;
  needsUrl: boolean;
  /** The URL field: a base URL, an endpoint, or (Devin) the organization ID. */
  urlLabel?: string;
  urlPlaceholder?: string;
  /** What the model field means for this provider, when it isn't a model. */
  modelLabel?: string;
  /** The model is required to run (beyond chat models, which always need one). */
  needsModel?: boolean;
  /** Built in and keyless: no key or URL fields. */
  builtIn?: boolean;
  /** Called from the browser, not the Focus proxy (local servers). */
  local?: boolean;
  hint?: string;
  color: string;
}

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  focus: {
    label: "Focus (free)",
    group: "free",
    agentName: "Focus",
    kinds: ["chat", "image"],
    models: { chat: "llm7/nemotron-3-nano:30b", image: "" },
    keyPlaceholder: "",
    needsKey: false,
    needsUrl: false,
    builtIn: true,
    hint: "Built in and free: no key, no sign-up. Pick a free model on the Agents page — NVIDIA Nemotron 3 Nano, MiniMax, Mistral, GPT-OSS or Codestral; they run straight from your browser with a fair-use limit. Focus Image makes one free picture every 45 seconds. Free models can't see attached images.",
    color: "#1d1d1d",
  },
  openrouter: {
    label: "OpenRouter",
    group: "free",
    agentName: "OpenRouter",
    kinds: ["chat"],
    models: { chat: "" },
    keyPlaceholder: "sk-or-…",
    keyUrl: "https://openrouter.ai/keys",
    needsKey: true,
    needsUrl: false,
    hint: "A free account gives you a dozen free models (their names end in :free) plus hundreds of paid ones.",
    color: "#6467f2",
  },
  ollama: {
    label: "Ollama (your computer)",
    group: "free",
    agentName: "Ollama",
    kinds: ["chat"],
    models: { chat: "" },
    keyPlaceholder: "",
    needsKey: false,
    needsUrl: false,
    urlLabel: "Ollama address",
    urlPlaceholder: "http://localhost:11434",
    local: true,
    hint: "Free models running on your own computer. Install Ollama, run `ollama pull llama3.2`, and start it with OLLAMA_ORIGINS=* so this page may talk to it.",
    color: "#5f5f5f",
  },
  anthropic: {
    label: "Anthropic",
    group: "chat",
    agentName: "Claude",
    kinds: ["chat"],
    models: { chat: "claude-opus-5-5" },
    keyPlaceholder: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
    needsKey: true,
    needsUrl: false,
    color: "#d97757",
  },
  openai: {
    label: "OpenAI",
    group: "chat",
    agentName: "GPT",
    kinds: ["chat", "image"],
    models: { chat: "", image: "gpt-image-1" },
    keyPlaceholder: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
    needsKey: true,
    needsUrl: false,
    color: "#10a37f",
  },
  gemini: {
    label: "Google Gemini",
    group: "chat",
    agentName: "Gemini",
    kinds: ["chat", "image", "video"],
    models: { chat: "", image: "imagen-4.0-generate-001", video: "veo-3.1-fast-generate-preview" },
    keyPlaceholder: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
    needsKey: true,
    needsUrl: false,
    hint: "The same key makes images (Imagen) and videos (Veo).",
    color: "#4285f4",
  },
  xai: {
    label: "xAI",
    group: "chat",
    agentName: "Grok",
    kinds: ["chat"],
    models: { chat: "" },
    keyPlaceholder: "xai-…",
    keyUrl: "https://console.x.ai",
    needsKey: true,
    needsUrl: false,
    color: "#3a3a3c",
  },
  custom: {
    label: "OpenAI-compatible",
    group: "chat",
    agentName: "Custom model",
    kinds: ["chat"],
    models: { chat: "" },
    keyPlaceholder: "API key (if the endpoint needs one)",
    needsKey: false,
    needsUrl: true,
    urlLabel: "Base URL",
    urlPlaceholder: "https://api.together.xyz/v1",
    hint: "Any endpoint that speaks the OpenAI chat API: Together, Groq, DeepSeek, Mistral, LM Studio…",
    color: "#8e8e93",
  },
  pollinations: {
    label: "Pollinations",
    group: "media",
    agentName: "Pollinations",
    kinds: ["video", "image", "chat"],
    models: { video: "alibaba/wan-2.2-fast", image: "zimage", chat: "openai" },
    keyPlaceholder: "sk_…",
    keyUrl: "https://enter.pollinations.ai",
    needsKey: true,
    needsUrl: false,
    hint: "One key for dozens of video models (Veo, Kling, Wan, Seedance…), image models and chat models. Pay as you go with Pollen credits.",
    color: "#22c55e",
  },
  luma: {
    label: "Luma Dream Machine",
    group: "media",
    agentName: "Luma",
    kinds: ["video"],
    models: { video: "ray-2" },
    keyPlaceholder: "luma-…",
    keyUrl: "https://lumalabs.ai/api/keys",
    needsKey: true,
    needsUrl: false,
    color: "#111827",
  },
  replicate: {
    label: "Replicate",
    group: "media",
    agentName: "Replicate",
    kinds: ["video", "image"],
    models: { video: "wan-video/wan-2.2-t2v-fast", image: "black-forest-labs/flux-schnell" },
    keyPlaceholder: "r8_…",
    keyUrl: "https://replicate.com/account/api-tokens",
    needsKey: true,
    needsUrl: false,
    modelLabel: "Model (owner/name)",
    needsModel: true,
    hint: "Thousands of open models for video and images. Use any model's “owner/name” from replicate.com.",
    color: "#ea2804",
  },
  manus: {
    label: "Manus",
    group: "agents",
    agentName: "Manus",
    kinds: ["agent"],
    models: { agent: "" },
    keyPlaceholder: "Manus API key",
    keyUrl: "https://manus.im",
    needsKey: true,
    needsUrl: false,
    modelLabel: "Agent profile (optional)",
    hint: "An autonomous agent that browses, codes and builds on its own. Create a key under Settings → Developers in Manus.",
    color: "#2b2b2b",
  },
  jules: {
    label: "Google Jules",
    group: "agents",
    agentName: "Jules",
    kinds: ["agent"],
    models: { agent: "" },
    keyPlaceholder: "Jules API key",
    keyUrl: "https://jules.google.com/settings",
    needsKey: true,
    needsUrl: false,
    modelLabel: "Repository",
    needsModel: true,
    hint: "A coding agent that works in your GitHub repo and opens a pull request. Connect the repo in Jules first, then pick it with Load (add @branch to use another branch).",
    color: "#7c3aed",
  },
  devin: {
    label: "Devin",
    group: "agents",
    agentName: "Devin",
    kinds: ["agent"],
    models: { agent: "" },
    keyPlaceholder: "cog_…",
    keyUrl: "https://app.devin.ai/settings/api-keys",
    needsKey: true,
    needsUrl: true,
    urlLabel: "Organization ID",
    urlPlaceholder: "org-…",
    modelLabel: "—",
    hint: "An autonomous software engineer. Use a service-user key and your organization ID from Settings → Devin API.",
    color: "#0ea5e9",
  },
  webhook: {
    label: "HTTP agent",
    group: "agents",
    agentName: "Agent",
    kinds: ["chat"],
    models: { chat: "" },
    keyPlaceholder: "Bearer token (optional)",
    needsKey: false,
    needsUrl: true,
    urlLabel: "Endpoint URL",
    urlPlaceholder: "https://your-endpoint.example/run",
    modelLabel: "Model (optional, passed along)",
    hint: "Anything else, through an endpoint of your own.",
    color: "#af52de",
  },
};

export const KIND_LABEL: Record<AgentKind, string> = { chat: "Chat", image: "Image", video: "Video", agent: "Autonomous agent" };

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

export function newAgent(connection: Connection, kind?: AgentKind): Agent {
  const info = PROVIDERS[connection.provider];
  const k = kind && info.kinds.includes(kind) ? kind : info.kinds[0];
  return {
    id: uid(),
    name: k === "chat" || info.kinds.length === 1 ? info.agentName : `${info.agentName} ${KIND_LABEL[k]}`,
    connectionId: connection.id,
    kind: k,
    model: info.models[k] ?? "",
    effort: connection.provider === "anthropic" ? "high" : "",
    role: "",
    color: info.color,
    enabled: true,
    skills: [],
    avatar: "",
  };
}

const STATE_VERSION = 4;

function focusAgents(focus: Connection): Agent[] {
  return [newAgent(focus, "chat"), { ...newAgent(focus, "image"), name: "Focus Image" }];
}

function defaults(): State {
  const focus = newConnection("focus");
  const connections = [focus, ...(["anthropic", "openai", "gemini", "xai"] as Provider[]).map(newConnection)];
  const agents = [...focusAgents(focus), ...connections.slice(1).map((c) => newAgent(c))];
  return {
    connections,
    agents,
    chats: [],
    // works right away: a one-on-one chat with the free model
    config: { mode: "solo", agentIds: agents.filter((a) => a.kind === "chat").map((a) => a.id), leadId: agents[0].id, rounds: 2 },
    sidebarCollapsed: false,
    skills: [],
    sound: true,
    version: STATE_VERSION,
  };
}

/** Adds the built-in free model and agent kinds to settings saved before they existed. */
function upgrade(state: State): State {
  if ((state.version ?? 2) >= STATE_VERSION) return state;
  for (const a of state.agents) a.kind ??= "chat";
  if (!state.connections.some((c) => c.provider === "focus")) {
    const focus = newConnection("focus");
    state.connections.unshift(focus);
    const added = focusAgents(focus);
    state.agents.unshift(...added);
    state.config.agentIds.push(added[0].id);
    if (!state.agents.some((a) => a.enabled && !missing(state, a) && a.connectionId !== focus.id)) {
      state.config.mode = "solo";
      state.config.leadId = added[0].id;
    }
  }
  // v4: skills, avatars, sound, and a choice of free models
  state.skills ??= [];
  state.sound ??= true;
  const focusIds = new Set(state.connections.filter((c) => c.provider === "focus").map((c) => c.id));
  for (const a of state.agents) {
    a.skills ??= [];
    a.avatar ??= "";
    if (focusIds.has(a.connectionId) && a.kind === "chat" && !/^(llm7|pollinations|openrouter)\//.test(a.model)) a.model = PROVIDERS.focus.models.chat!;
  }
  state.version = STATE_VERSION;
  return state;
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
      state.version = 2;
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
      const state: State = upgrade({ ...base, ...saved, version: saved.version ?? 2, config: { ...base.config, ...saved.config } });
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
    if (migrated) return upgrade(migrated);
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
  if (info.needsUrl && !conn.baseUrl.trim()) return `needs ${info.urlLabel?.toLowerCase() ?? "URL"}`;
  if (info.needsKey && !conn.apiKey.trim()) return "needs key";
  const needsModel = info.needsModel || (agent.kind === "chat" && conn.provider !== "webhook");
  if (needsModel && !agent.model.trim()) return info.modelLabel ? `needs ${info.modelLabel.toLowerCase().replace(/ \(.*\)$/, "")}` : "needs model";
  return null;
}

export const isReady = (state: State, agent: Agent) => agent.enabled && !missing(state, agent);
