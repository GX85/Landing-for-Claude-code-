import { defaultTools, type ToolsConfig } from "./tools";
export type Provider =
  | "focus"
  | "anthropic"
  | "openai"
  | "gemini"
  | "xai"
  | "mistral"
  | "qwen"
  | "openrouter"
  | "ollama"
  | "pollinations"
  | "custom"
  | "webhook"
  | "luma"
  | "replicate"
  | "higgsfield"
  | "manus"
  | "jules"
  | "devin"
  | "together"
  | "siliconflow"
  | "nebius"
  | "deepinfra"
  | "huggingface"
  | "cloudflare"
  | "stability"
  | "fal"
  | "segmind"
  | "deepai"
  | "minimax"
  | "runway"
  | "ideogram"
  | "bfl";
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
/** An agent the user designed in Focus: a personality, a model and a way of thinking. */
export interface FocusAgent {
  id: string;
  name: string;
  color: string;
  /** Who the agent is and how it behaves, in the user's words. */
  instructions: string;
  /** An OpenRouter model id, or "" to let Focus pick by tier. */
  model: string;
  tier: Tier;
  /** Brainstorm level: 0 auto … 4 UltraVision. */
  think: number;
  /** 0 precise … 1 inventive. */
  creativity: number;
  style: "short" | "balanced" | "detailed";
  skills: string[];
  starters: string[];
  createdAt: number;
}

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
  /** Focus agents: an OpenRouter model to try before the tier's own. */
  prefer?: string;
  /** Forces the Builder for this agent's next answer (game, presentation, website or app). */
  create?: CreateKind;
  /** Focus agents: sampling temperature. */
  temperature?: number;
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

/** Who Focus is, in every tier: a sharp, warm, funny mind, not a corporate help desk. */
export const PERSONA = `You are Focus, an AI made by Team Swift. You talk like a brilliant, warm friend who happens to know a lot: curious, direct, honest, with a dry, quick sense of humour.

How you think:
- Work out what the person actually needs, including what they didn't say. Think the problem through before you answer; check your reasoning and your facts.
- Be right first, then be brief. Lead with the answer, then the reasoning that matters. No filler, no restating the question.
- If something is uncertain, say so plainly and say what would settle it. Never invent facts, sources, numbers or quotes.
- Have opinions when asked and give real recommendations, not a list of "it depends".
- Ask a clarifying question only when you truly can't proceed; otherwise make a sensible assumption and mention it.
- For maths, logic and code: work step by step (silently), then double-check the result before you give it: recompute numbers, trace the code on an example, test edge cases.
- For facts that may have changed (prices, news, versions, who holds a role), say what you know and when it could be outdated, or use the web tool when it's on.
- Prefer concrete over generic: real names, numbers, examples, commands and next steps the person can use right away.

How you talk:
- Always reply in the user's language, matching their tone: casual with casual, precise with technical.
- Sound human. Short sentences, plain words, a light joke when it fits the moment (never at the user's expense, never when they're upset or it's serious). One good line beats three forced ones.
- Never say "As an AI", "Great question", "I hope this helps" or "Certainly!". No corporate tone, no moralising, no walls of disclaimers.
- Use Markdown only when it helps: lists for steps, tables for comparisons, code blocks for code. Emoji rarely.
- Write maths in plain text with ×, ÷, ², √ and so on: no LaTeX, no $…$ or \( \) (the chat doesn't render it).
- Small talk gets a short, lively reply, not a self-introduction or a list of your abilities.`;

/**
 * Focus tiers. Each tries its OpenRouter models first (through Focus's key, or the user's own),
 * then falls back to keyless free models, so every tier works with no setup at all.
 */
export const TIERS: Record<Tier, { name: string; tag: string; blurb: string; /** Ollama Cloud models run with the site's key: the fastest and smartest Focus has, tried first. */ ollama: string[]; or: string[]; free: string[]; role: string }> = {
  storm: {
    name: "Storm",
    tag: "Lightning fast",
    blurb: "The lightest, fastest models. Short answers in a flash.",
    ollama: ["deepseek-v4.1-flash", "glm-5.3-flash", "gpt-oss:120b", "gemma4:31b", "nemotron-3-super"],
    or: ["nvidia/nemotron-3.5-lightning:free", "google/gemma-4-26b-a4b-it:free", "google/gemma-4-31b-it:free"],
    free: ["llm7/mistral-Nemo-Instruct-2407", "pollinations/openai-fast"],
    role: "Tier: Storm, the fastest Focus. Keep answers short and punchy: a few sentences or a tight list, unless the user asks for depth.",
  },
  gen: {
    name: "GEN",
    tag: "Balanced",
    blurb: "Mid-size models: quick enough for chat, sharp enough for real work.",
    ollama: ["kimi-k3", "deepseek-v4-pro", "glm-5.3", "gpt-oss:120b", "nemotron-3-ultra", "gemma4:31b"],
    or: ["thinkingmachines/inkling:free", "nvidia/nemotron-3.5-super-vl:free", "google/gemma-4-31b-it:free"],
    free: ["llm7/nemotron-3-nano:30b", "llm7/minimax-m2.7"],
    role: "Tier: GEN, the everyday Focus. Balance depth and length to the question.",
  },
  clorus: {
    name: "Clorus",
    tag: "Smartest · builds things",
    blurb: "The most capable models. Makes presentations, games, websites and apps you can preview right in the chat.",
    ollama: ["kimi-k3", "deepseek-v4-pro", "glm-5.3", "nemotron-3-ultra", "gpt-oss:120b", "nemotron-3-super"],
    or: ["nvidia/nemotron-3-ultra-550b-a55b:free", "thinkingmachines/inkling:free", "poolside/laguna-s-2.1:free", "nvidia/nemotron-3.5-super-vl:free"],
    free: ["llm7/minimax-m2.7", "llm7/gpt-oss:20b"],
    role:
      "Tier: Clorus, the deepest Focus. Reason carefully and thoroughly; for hard questions, structure the answer. When asked to build a presentation, game, website or app, reply with ONE complete, self-contained HTML file in a single ```html code block: inline CSS and JavaScript, no external files, no build step, polished, responsive and with a real design. For a presentation, make full-screen slides with arrow-key and swipe navigation. After the code, add a one-line note on how to use it.",
  },
};

export const TIER_ORDER: Tier[] = ["storm", "gen", "clorus"];

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

/** Focus: one assistant in three tiers. Aeronus: the agent hub, a whole team. */
export type Hub = "focus" | "aeronus";
export type Tier = "storm" | "gen" | "clorus";

/** What a message asks Focus to make, chosen from the + menu. */
export type CreateKind = "game" | "presentation" | "website" | "app" | "image" | "video";

export interface ChatConfig {
  hub: Hub;
  tier: Tier;
  /** Thinking level for Focus: 0 auto, 1 quick, 2 thoughtful, 3 deep, 4 UltraVision. */
  think?: number;
  /** A Focus agent to talk to instead of plain Focus. */
  agentId?: string;
  mode: ModeId;
  agentIds: string[];
  leadId: string;
  rounds: number;
}

export interface StepRecord {
  provider?: Provider;
  /** Set for agents built in Focus: their square's colour. */
  mascot?: string;
  /** a Focus tier answered: show the Focus mark instead of a letter */
  focus?: boolean;
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
  /** Set when the message was sent from the + menu's Create list. */
  create?: CreateKind;
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
  /** Agents the user built in Focus. */
  focusAgents: FocusAgent[];
  /** Which model answers in each hub; "auto" leaves it to Focus. */
  settings: { focus: ModelChoice; aeronus: ModelChoice; /** Skill ids switched on for every Focus chat. */ skills: string[]; tools: ToolsConfig; /** Aeronus (the multi-agent team) is offered in the chat. */ teamMode?: boolean };
  version?: number;
}

export type ModelSource = "auto" | "openrouter" | "ollama";
export interface ModelChoice {
  source: ModelSource;
  /** The model's id on that service, without the service prefix. */
  model: string;
}

export const defaultSettings = (): State["settings"] => ({ focus: { source: "auto", model: "" }, aeronus: { source: "auto", model: "" }, skills: [], tools: defaultTools() });

/** The model string the chat runner understands for a choice, or undefined to let Focus decide. */
export const choiceModel = (c: ModelChoice | undefined): string | undefined => (c && c.source !== "auto" && c.model ? `${c.source}/${c.model}` : undefined);

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
    kinds: ["chat", "image", "video"],
    models: { chat: "llm7/nemotron-3-nano:30b", image: "", video: "" },
    keyPlaceholder: "",
    needsKey: false,
    needsUrl: false,
    builtIn: true,
    hint: "Built in and free: no key, no sign-up. Pick a free model on the Agents page — NVIDIA Nemotron 3 Nano, MiniMax, Mistral, GPT-OSS or Codestral; they run straight from your browser with a fair-use limit. Focus Image makes free pictures and Focus Video writes a short animated film that plays right in the chat. Free models can't see attached images.",
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
  mistral: {
    label: "Mistral",
    group: "chat",
    agentName: "Mistral",
    kinds: ["chat"],
    models: { chat: "mistral-large-latest" },
    keyPlaceholder: "…",
    keyUrl: "https://console.mistral.ai/api-keys",
    needsKey: true,
    needsUrl: false,
    hint: "Mistral Large, Medium, Small and Codestral. The free “Experiment” plan works with a phone number.",
    color: "#fa520f",
  },
  qwen: {
    label: "Qwen (Alibaba)",
    group: "chat",
    agentName: "Qwen",
    kinds: ["chat"],
    models: { chat: "qwen-plus" },
    keyPlaceholder: "sk-…",
    keyUrl: "https://bailian.console.alibabacloud.com/?apiKey=1",
    needsKey: true,
    needsUrl: false,
    hint: "Qwen Max, Plus and Flash through Alibaba Cloud Model Studio (international). New accounts get free tokens.",
    color: "#615ced",
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
  higgsfield: {
    label: "Higgsfield",
    group: "media",
    agentName: "Higgsfield",
    kinds: ["image", "video"],
    models: { image: "higgsfield-ai/soul/v2/standard", video: "" },
    keyPlaceholder: "KEY_ID:KEY_SECRET",
    keyUrl: "https://console.higgsfield.ai",
    needsKey: true,
    needsUrl: false,
    modelLabel: "Model path",
    needsModel: true,
    hint: "Cinematic images and video. Paste your key as KEY_ID:KEY_SECRET from console.higgsfield.ai, and set the model path shown on the model's page there (for images: higgsfield-ai/soul/v2/standard).",
    color: "#c6ff3d",
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
  together: {
    label: "Together AI",
    group: "media",
    agentName: "Together",
    kinds: ["image"],
    models: { image: "black-forest-labs/FLUX.1-schnell-Free" },
    keyPlaceholder: "tgp_…",
    keyUrl: "https://api.together.xyz/settings/api-keys",
    needsKey: true,
    needsUrl: false,
    hint: "FLUX.1 schnell Free costs nothing; other FLUX models use your credits.",
    color: "#0f6fff",
  },
  siliconflow: {
    label: "SiliconFlow",
    group: "media",
    agentName: "SiliconFlow",
    kinds: ["image", "video"],
    models: { image: "Kwai-Kolors/Kolors", video: "Wan-AI/Wan2.2-T2V-A14B" },
    keyPlaceholder: "sk-…",
    keyUrl: "https://cloud.siliconflow.com/account/ak",
    needsKey: true,
    needsUrl: false,
    hint: "Kolors and FLUX schnell images, Wan 2.2 video. New accounts get free credits.",
    color: "#7c3aed",
  },
  nebius: {
    label: "Nebius AI Studio",
    group: "media",
    agentName: "Nebius",
    kinds: ["image"],
    models: { image: "black-forest-labs/flux-schnell" },
    keyPlaceholder: "…",
    keyUrl: "https://studio.nebius.com/settings/api-keys",
    needsKey: true,
    needsUrl: false,
    hint: "FLUX and SDXL. Starts with free credits.",
    color: "#d4f84b",
  },
  deepinfra: {
    label: "DeepInfra",
    group: "media",
    agentName: "DeepInfra",
    kinds: ["image"],
    models: { image: "black-forest-labs/FLUX-1-schnell" },
    keyPlaceholder: "…",
    keyUrl: "https://deepinfra.com/dash/api_keys",
    needsKey: true,
    needsUrl: false,
    hint: "Cheap FLUX and SDXL-Turbo, with free starting credits.",
    color: "#4f46e5",
  },
  huggingface: {
    label: "Hugging Face",
    group: "media",
    agentName: "Hugging",
    kinds: ["image"],
    models: { image: "black-forest-labs/FLUX.1-schnell" },
    keyPlaceholder: "hf_…",
    keyUrl: "https://huggingface.co/settings/tokens",
    needsKey: true,
    needsUrl: false,
    hint: "Free monthly credits with any account. Use any text-to-image model id from huggingface.co.",
    color: "#ff9d00",
  },
  cloudflare: {
    label: "Cloudflare Workers AI",
    group: "media",
    agentName: "Cloudflare",
    kinds: ["image"],
    models: { image: "@cf/black-forest-labs/flux-1-schnell" },
    keyPlaceholder: "Workers AI token",
    keyUrl: "https://dash.cloudflare.com/profile/api-tokens",
    needsKey: true,
    needsUrl: true,
    urlLabel: "Account ID",
    urlPlaceholder: "32-character account ID",
    hint: "Free daily allowance. Needs a Workers AI token and your account ID.",
    color: "#f38020",
  },
  stability: {
    label: "Stability AI",
    group: "media",
    agentName: "Stability",
    kinds: ["image"],
    models: { image: "core" },
    keyPlaceholder: "sk-…",
    keyUrl: "https://platform.stability.ai/account/keys",
    needsKey: true,
    needsUrl: false,
    hint: "Stable Image Core, Ultra and SD 3.5. Free credits on sign-up.",
    color: "#a855f7",
  },
  fal: {
    label: "fal",
    group: "media",
    agentName: "fal",
    kinds: ["image", "video"],
    models: { image: "fal-ai/flux/schnell", video: "fal-ai/ltx-video" },
    keyPlaceholder: "key-id:secret",
    keyUrl: "https://fal.ai/dashboard/keys",
    needsKey: true,
    needsUrl: false,
    hint: "FLUX, Recraft and Ideogram images; LTX, Wan, Kling and Hailuo video. Use any fal model id.",
    color: "#111111",
  },
  segmind: {
    label: "Segmind",
    group: "media",
    agentName: "Segmind",
    kinds: ["image"],
    models: { image: "flux-schnell" },
    keyPlaceholder: "SG_…",
    keyUrl: "https://cloud.segmind.com/console/api-keys",
    needsKey: true,
    needsUrl: false,
    hint: "FLUX and SDXL with free daily credits.",
    color: "#2563eb",
  },
  deepai: {
    label: "DeepAI",
    group: "media",
    agentName: "DeepAI",
    kinds: ["image"],
    models: { image: "text2img" },
    keyPlaceholder: "…",
    keyUrl: "https://deepai.org/dashboard/profile",
    needsKey: true,
    needsUrl: false,
    hint: "Simple, quick images.",
    color: "#16a34a",
  },
  minimax: {
    label: "MiniMax Hailuo",
    group: "media",
    agentName: "MiniMax",
    kinds: ["video", "image"],
    models: { video: "MiniMax-Hailuo-02", image: "image-01" },
    keyPlaceholder: "eyJ…",
    keyUrl: "https://www.minimax.io/platform/user-center/basic-information/interface-key",
    needsKey: true,
    needsUrl: false,
    hint: "Hailuo video and image-01 pictures. New accounts get free trial credits.",
    color: "#e11d48",
  },
  runway: {
    label: "Runway",
    group: "media",
    agentName: "Runway",
    kinds: ["video", "image"],
    models: { video: "gen4_turbo", image: "gen4_image" },
    keyPlaceholder: "key_…",
    keyUrl: "https://dev.runwayml.com/",
    needsKey: true,
    needsUrl: false,
    hint: "Gen-4 video from a picture (attach one) and Gen-4 images. Paid credits.",
    color: "#000000",
  },
  ideogram: {
    label: "Ideogram",
    group: "media",
    agentName: "Ideogram",
    kinds: ["image"],
    models: { image: "V_3_TURBO" },
    keyPlaceholder: "…",
    keyUrl: "https://ideogram.ai/manage-api",
    needsKey: true,
    needsUrl: false,
    hint: "Best at text inside images: posters, logos, covers.",
    color: "#3b3b3b",
  },
  bfl: {
    label: "Black Forest Labs",
    group: "media",
    agentName: "Black",
    kinds: ["image"],
    models: { image: "flux-pro-1.1" },
    keyPlaceholder: "…",
    keyUrl: "https://dashboard.bfl.ai/",
    needsKey: true,
    needsUrl: false,
    hint: "FLUX Pro and Kontext straight from its makers. Attach a picture to edit it with Kontext.",
    color: "#0b0b0b",
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

const STATE_VERSION = 9;

/** The Aeronus team out of the box: every one needs the user's own key. */
const TEAM_PROVIDERS: Provider[] = ["anthropic", "openai", "gemini", "xai", "mistral", "qwen", "devin", "manus", "jules", "higgsfield", "luma", "replicate"];

function focusAgents(focus: Connection): Agent[] {
  return [newAgent(focus, "chat"), { ...newAgent(focus, "image"), name: "Focus Image" }, { ...newAgent(focus, "video"), name: "Focus Video" }];
}

function defaults(): State {
  const focus = newConnection("focus");
  const connections = [focus, ...TEAM_PROVIDERS.map(newConnection)];
  const agents = [...focusAgents(focus), ...connections.slice(1).map((c) => newAgent(c))];
  return {
    connections,
    agents,
    chats: [],
    // works right away: a one-on-one chat with the free model
    config: { hub: "focus", tier: "gen", mode: "solo", agentIds: agents.filter((a) => a.kind === "chat" || a.connectionId === focus.id).map((a) => a.id), leadId: agents[0].id, rounds: 2 },
    sidebarCollapsed: false,
    skills: [],
    sound: true,
    focusAgents: [],
    settings: defaultSettings(),
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
  // v5: Focus tiers vs Aeronus hub, plus Mistral, Qwen, Devin, Manus and Jules in the team
  state.config.hub ??= "focus";
  state.config.tier ??= "gen";
  // UltraVision is slow, so it never carries over into later sessions
  if (state.config.think === 4) state.config.think = 0;
  for (const provider of TEAM_PROVIDERS) {
    if (state.connections.some((c) => c.provider === provider)) continue;
    const conn = newConnection(provider);
    state.connections.push(conn);
    const agent = newAgent(conn);
    state.agents.push(agent);
    if (agent.kind === "chat") state.config.agentIds.push(agent.id);
  }
  // v6: agents built in Focus
  state.focusAgents ??= [];
  state.settings ??= defaultSettings();
  // v7: Focus Video, and the picture and video generators join the Aeronus team
  const focusConn = state.connections.find((c) => c.provider === "focus");
  if (focusConn && !state.agents.some((a) => a.connectionId === focusConn.id && a.kind === "video")) state.agents.push({ ...newAgent(focusConn, "video"), name: "Focus Video" });
  for (const a of state.agents) {
    if ((a.kind === "image" || a.kind === "video") && focusIds.has(a.connectionId) && !state.config.agentIds.includes(a.id)) state.config.agentIds.push(a.id);
  }
  // v8: skills for every chat, and the tools (internet, device)
  state.settings.skills ??= [];
  state.settings.tools ??= defaultTools();
  // v9: Aeronus is switched on in Settings; people already using it keep it
  state.settings.teamMode ??= state.config.hub === "aeronus" || state.chats.some((c) => c.config.hub === "aeronus");
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

export const AGENT_COLORS = ["#ffffff", "#ff4d4d", "#ffb8ff", "#00e5ff", "#ffb852", "#2121de", "#39ff88", "#ffd60a", "#1d1d1f", "#9b5de5"];

export function newFocusAgent(n: number): FocusAgent {
  return {
    id: uid(),
    name: `Agent ${n}`,
    color: AGENT_COLORS[(n - 1) % AGENT_COLORS.length],
    instructions: "",
    model: "",
    tier: "gen",
    think: 0,
    creativity: 0.5,
    style: "balanced",
    skills: [],
    starters: [],
    createdAt: Date.now(),
  };
}
