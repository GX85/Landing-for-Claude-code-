import { getLang } from "../i18n";

/**
 * Tools the AI can use while it answers: the internet, and (when the person allows it) their own device.
 * Free chat models don't have a tool API, so a tool call is a fenced JSON block in the reply; Focus runs it,
 * hands the result back and lets the model carry on, a few rounds at most.
 */
export interface ToolsConfig {
  web: boolean;
  location: boolean;
  bridge: { on: boolean; url: string; token: string; shell: boolean; /** open apps and links, clipboard, notifications, typing, screenshots */ control?: boolean };
}

export const defaultTools = (): ToolsConfig => ({ web: true, location: false, bridge: { on: false, url: "http://127.0.0.1:7788", token: "", shell: false, control: true } });

let cfg: ToolsConfig = defaultTools();
export const setToolsConfig = (c: ToolsConfig | undefined) => (cfg = c ?? defaultTools());
const available = () => import.meta.env.VITE_ARTIFACT !== "1";
export const toolsOn = () => available() && (cfg.web || cfg.location || (cfg.bridge.on && !!cfg.bridge.token));

const ru = () => getLang() === "ru";

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface Source {
  title: string;
  url: string;
}

const CONTROL = ["open", "clipboard_read", "clipboard_write", "notify", "type_text", "screenshot"];
const NAMES = ["web_search", "web_fetch", "my_location", "fs_list", "fs_read", "fs_search", "shell", "device_info", ...CONTROL];
const controlOn = () => cfg.bridge.on && !!cfg.bridge.token && cfg.bridge.control !== false;

/** The instructions that teach a model to use the tools that are switched on. */
export function toolsPrompt(): string {
  const lines: string[] = [];
  if (cfg.web) {
    lines.push('web_search {"query": string} — search the internet; returns titles, links and snippets.');
    lines.push('web_fetch {"url": string} — open a web page and read its text.');
  }
  if (cfg.location) lines.push("my_location {} — the user's current coordinates (they are asked to allow it).");
  if (cfg.bridge.on && cfg.bridge.token) {
    lines.push('device_info {} — the user\'s device: system, folders you may use.');
    lines.push('fs_list {"path": string} — list a folder on the user\'s device.');
    lines.push('fs_read {"path": string} — read a text file on the user\'s device.');
    lines.push('fs_search {"query": string, "path": string} — find files by name or by content under a folder.');
    if (cfg.bridge.shell) lines.push('shell {"command": string} — run a shell command on the user\'s device (the user approves each one).');
    if (controlOn()) {
      lines.push('open {"target": string} — open a link in the browser, a file from the folder above, or an app by name (e.g. "Calculator", "Spotify").');
      lines.push("clipboard_read {} — read what the user copied.");
      lines.push('clipboard_write {"text": string} — put text on the user\'s clipboard.');
      lines.push('notify {"title": string, "text": string} — show a notification on the device (reminders, results).');
      lines.push('type_text {"text": string} — type text into the window the user has open.');
      lines.push("screenshot {} — save a screenshot of the screen into the folder above.");
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  return `You can use tools. Today is ${today}. To use one, reply with ONLY a fenced block and nothing else:\n\`\`\`tool\n{"tool": "web_search", "query": "…"}\n\`\`\`\nTools:\n${lines.map((l) => `- ${l}`).join("\n")}\nUse a tool when the answer depends on current or outside facts, on a web page, or on the user's own files. Otherwise answer directly. Never invent a result: wait for it. After a result you may call another tool, or answer. Cite sources you used by name. Don't repeat a call.`;
}

/** When the message plainly asks for the internet or the user's files, say so: free models otherwise talk about doing it. */
export function intentHint(text: string): string {
  const web = /(найди в (интернете|сети)|в интернете|поищи|погугли|загугли|search (the )?(web|internet|online)|look (it )?up|google|latest news|сегодня|сейчас|актуальн|курс (доллар|евро|валют)|погод|новост|кто победил|last night)/i.test(text);
  const dev = /(мои файлы|моих файлах|моём компьютере|моем компьютере|на (моём|моем) (телефоне|устройстве)|в моей папке|my files|on my (phone|computer|device|laptop)|in my folder)/i.test(text);
  const act = /(открой|запусти|скопируй в буфер|буфер обмена|напомни|уведомлени|напечатай|скриншот|снимок экрана|\bopen\b|\blaunch\b|clipboard|remind me|notification|screenshot|type (this|it))/i.test(text);
  const need = [web && cfg.web ? 'web_search (and web_fetch to open a result)' : "", dev && cfg.bridge.on && cfg.bridge.token ? "fs_search, fs_list or fs_read" : "", act && controlOn() ? "open, clipboard_read, clipboard_write, notify, type_text or screenshot" : ""].filter(Boolean);
  return need.length ? `\nThis message needs ${need.join(" and ")}: your reply must be a tool block right now, nothing else.` : "";
}

/** The tool call a reply asks for, if it is one. */
export function parseToolCall(text: string): ToolCall | null {
  // the block may be ```tool {"tool": …}```, or the tool's own name as the fence label: ```fs_search {"query": …}```
  const named = new RegExp(`\`\`\`(${NAMES.join("|")})\\s*(\\{[\\s\\S]*?\\})?\\s*\`\`\``).exec(text);
  const m = named ?? /```(?:tool|json)?\s*(\{[\s\S]*?\})\s*```/.exec(text) ?? (/^\s*(\{\s*"tool"[\s\S]*\})\s*$/.exec(text) as RegExpExecArray | null);
  if (!m) return null;
  try {
    if (named) return { tool: named[1], args: named[2] ? (JSON.parse(named[2]) as Record<string, unknown>) : {} };
    const obj = JSON.parse(m[1]) as Record<string, unknown>;
    const tool = typeof obj.tool === "string" ? obj.tool : "";
    if (!NAMES.includes(tool)) return null;
    const { tool: _t, ...args } = obj;
    void _t;
    return { tool, args: (args.args as Record<string, unknown>) ?? args };
  } catch {
    return null;
  }
}

/** True while a streaming reply could still turn out to be a tool call, so it isn't shown yet. */
export const looksLikeTool = (t: string): boolean => {
  const s = t.trimStart();
  if (s.length < 7) return s.length > 0 && "```tool".startsWith(s);
  return s.startsWith("```tool") || s.startsWith('{"tool"') || /^```json\s*\{\s*"tool"/.test(s) || new RegExp(`^\`\`\`(${NAMES.join("|")})\\b`).test(s);
};

/** A one-line note for the chat while a tool runs. */
export function toolNote(call: ToolCall): string {
  const a = call.args;
  const q = String(a.query ?? a.url ?? a.path ?? a.command ?? a.target ?? a.title ?? "").slice(0, 80);
  const en: Record<string, string> = { web_search: "Searching the web", web_fetch: "Reading a page", my_location: "Checking the location", fs_list: "Looking at a folder", fs_read: "Reading a file", fs_search: "Searching your files", shell: "Running a command", device_info: "Checking the device", open: "Opening", clipboard_read: "Reading the clipboard", clipboard_write: "Copying to the clipboard", notify: "Sending a notification", type_text: "Typing", screenshot: "Taking a screenshot" };
  const rus: Record<string, string> = { web_search: "Ищу в интернете", web_fetch: "Читаю страницу", my_location: "Определяю место", fs_list: "Смотрю папку", fs_read: "Читаю файл", fs_search: "Ищу в ваших файлах", shell: "Выполняю команду", device_info: "Смотрю устройство", open: "Открываю", clipboard_read: "Читаю буфер обмена", clipboard_write: "Копирую в буфер", notify: "Отправляю уведомление", type_text: "Печатаю", screenshot: "Делаю скриншот" };
  return `${(ru() ? rus : en)[call.tool] ?? call.tool}${q ? `: ${q}` : ""}…`;
}

async function web(body: object, signal: AbortSignal): Promise<Record<string, unknown>> {
  const res = await fetch("/api/web", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!res.ok) throw new Error(data.error || `The web tool answered ${res.status}.`);
  return data;
}

async function bridge(tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const b = cfg.bridge;
  let res: Response;
  try {
    res = await fetch(`${b.url.replace(/\/$/, "")}/tool`, { method: "POST", headers: { "content-type": "application/json", "x-focus-token": b.token }, body: JSON.stringify({ tool, args }), signal });
  } catch {
    throw new Error(ru() ? "Не удаётся связаться с программой на устройстве. Она запущена?" : "Can't reach the Focus device program. Is it running?");
  }
  const data = (await res.json().catch(() => ({}))) as { result?: string; error?: string };
  if (!res.ok) throw new Error(data.error || `The device program answered ${res.status}.`);
  return String(data.result ?? "");
}

const place = (): Promise<string> =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Location isn't available in this browser."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(`latitude ${p.coords.latitude.toFixed(5)}, longitude ${p.coords.longitude.toFixed(5)} (accuracy ${Math.round(p.coords.accuracy)} m)`),
      () => reject(new Error("The user didn't allow location access.")),
      { timeout: 15000 },
    );
  });

/** Runs one tool. Never throws: a failure comes back as text the model can read. */
export async function runTool(call: ToolCall, signal: AbortSignal): Promise<{ text: string; sources: Source[] }> {
  const sources: Source[] = [];
  try {
    const a = call.args;
    switch (call.tool) {
      case "web_search": {
        if (!cfg.web) return { text: "Web access is switched off in Settings.", sources };
        const d = (await web({ action: "search", query: String(a.query ?? "") }, signal)) as { results?: { title: string; url: string; snippet: string }[] };
        const rows = d.results ?? [];
        for (const r of rows) sources.push({ title: r.title, url: r.url });
        return { text: rows.length ? rows.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n") : "No results.", sources };
      }
      case "web_fetch": {
        if (!cfg.web) return { text: "Web access is switched off in Settings.", sources };
        const d = (await web({ action: "fetch", url: String(a.url ?? "") }, signal)) as { url: string; title: string; text: string };
        sources.push({ title: d.title || d.url, url: d.url });
        return { text: `${d.title ? `${d.title}\n` : ""}${d.url}\n\n${d.text}`, sources };
      }
      case "my_location":
        if (!cfg.location) return { text: "Location access is switched off in Settings.", sources };
        return { text: await place(), sources };
      case "device_info":
      case "fs_list":
      case "fs_read":
      case "fs_search":
      case "shell": {
        if (!(cfg.bridge.on && cfg.bridge.token)) return { text: "The device connection is switched off in Settings.", sources };
        if (call.tool === "shell") {
          if (!cfg.bridge.shell) return { text: "Commands are switched off in Settings.", sources };
          const ok = confirm(`${ru() ? "Focus хочет выполнить команду на вашем устройстве:" : "Focus wants to run this command on your device:"}\n\n${String(a.command ?? "")}\n\n${ru() ? "Разрешить?" : "Allow?"}`);
          if (!ok) return { text: "The user declined to run this command.", sources };
        }
        return { text: await bridge(call.tool, a, signal), sources };
      }
      case "open":
      case "clipboard_read":
      case "clipboard_write":
      case "notify":
      case "type_text":
      case "screenshot": {
        if (!controlOn()) return { text: "Device control is switched off in Settings.", sources };
        const what: Record<string, [string, string]> = {
          open: [`open ${String(a.target ?? "")}`, `открыть ${String(a.target ?? "")}`],
          clipboard_read: ["read your clipboard", "прочитать буфер обмена"],
          clipboard_write: [`copy to your clipboard:\n${String(a.text ?? "").slice(0, 300)}`, `скопировать в буфер обмена:\n${String(a.text ?? "").slice(0, 300)}`],
          notify: [`show a notification: ${String(a.title ?? "")} — ${String(a.text ?? "")}`, `показать уведомление: ${String(a.title ?? "")} — ${String(a.text ?? "")}`],
          type_text: [`type into the open window:\n${String(a.text ?? "").slice(0, 300)}`, `напечатать в открытом окне:\n${String(a.text ?? "").slice(0, 300)}`],
          screenshot: ["take a screenshot", "сделать скриншот"],
        };
        const [en, rus] = what[call.tool];
        if (!confirm(`${ru() ? "Focus хочет" : "Focus wants to"} ${ru() ? rus : en}\n\n${ru() ? "Разрешить?" : "Allow?"}`)) return { text: "The user declined this action.", sources };
        return { text: await bridge(call.tool, a, signal), sources };
      }
    }
    return { text: "Unknown tool.", sources };
  } catch (error) {
    if (signal.aborted) throw error;
    return { text: `The tool failed: ${error instanceof Error ? error.message : String(error)}`, sources };
  }
}
