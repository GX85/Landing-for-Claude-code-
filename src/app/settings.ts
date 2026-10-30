import type { Ctx } from "./app";
import { setToolsConfig } from "./tools";
import { accountSection } from "./account";
import { h, pageHead, slideSeg } from "./dom";
import { getLang, setLang, type Lang } from "../i18n";
import { openRouterCatalog, resetCatalog } from "./pages";
import { liveModelsAt, refreshLiveModels } from "./api";
import { allSkills, uid, type ModelChoice, type ModelSource, type Skill } from "./store";

/** Settings: which model answers in Focus and which in Aeronus. */

let ollamaModels: string[] | undefined;
let ollamaSpeed = new Map<string, number>();
/** The models Focus itself prefers: the smartest that answer fast. */
const BEST = new Set(["gpt-oss:120b", "nemotron-3-ultra", "gemma4:31b"]);
let updateNote = "";
let ollamaLoading = false;
const OLLAMA_FALLBACK = ["gpt-oss:120b", "gpt-oss:20b"];

/** Fetches both model lists again, so new and retired models show up. */
async function updateModels(rerender: () => void): Promise<void> {
  updateNote = "Updating…";
  rerender();
  resetCatalog();
  ollamaModels = undefined;
  ollamaLoading = false;
  try {
    const total = await refreshLiveModels();
    updateNote = `Updated just now · ${total} OpenRouter models`;
  } catch {
    updateNote = "Couldn't reach OpenRouter. The lists below are the ones from before.";
  }
  rerender();
}

function ollamaCatalog(onLoad: () => void): string[] {
  if (ollamaModels) return ollamaModels;
  if (import.meta.env.VITE_ARTIFACT === "1") return (ollamaModels = OLLAMA_FALLBACK);
  if (!ollamaLoading) {
    ollamaLoading = true;
    fetch("/api/models?ollama=1", { method: "POST", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no list"))))
      .then((d: { models?: string[]; details?: { id: string; ms: number }[] }) => {
        ollamaSpeed = new Map((d.details ?? []).map((x) => [x.id, x.ms]));
        // best ones first, then the rest by speed
        ollamaModels = d.models?.length ? [...d.models.filter((m) => BEST.has(m)), ...d.models.filter((m) => !BEST.has(m))] : OLLAMA_FALLBACK;
        onLoad();
      })
      .catch(() => {
        ollamaModels = OLLAMA_FALLBACK;
        onLoad();
      });
  }
  return [];
}

const SOURCES: { id: ModelSource; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Recommended. Focus picks the best model for each message: code and maths go to the strongest reasoners, stories to the most fluent writer, and a model that fails is skipped for a few minutes." },
  { id: "openrouter", label: "OpenRouter", hint: "Any of about 460 OpenRouter models. Free ones cost nothing; others use your OpenRouter key from Connections." },
  { id: "ollama", label: "Ollama", hint: "Ollama Cloud models, served through Focus. Only the ones that answer right now are listed, with their response time; ★ marks the smartest fast ones." },
];

function section(ctx: Ctx, key: "focus" | "aeronus", title: string, lede: string, rerender: () => void): HTMLElement {
  const choice: ModelChoice = ctx.state.settings[key];
  const save = () => {
    ctx.persist();
    rerender();
  };

  const seg = h(
    "div",
    { class: "ma-seg set-seg", role: "radiogroup", "aria-label": `${title} model source` },
    ...SOURCES.map((s) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          "aria-checked": String(choice.source === s.id),
          onclick: () => {
            if (choice.source === s.id) return;
            choice.source = s.id;
            if (s.id === "auto") choice.model = "";
            else if (!choice.model) choice.model = "";
            save();
          },
        },
        s.label,
      ),
    ),
  );

  const hint = h("p", { class: "field-hint set-hint" }, SOURCES.find((s) => s.id === choice.source)?.hint ?? "");
  const body = h("div", { class: "set-body ma-model" });

  if (choice.source !== "auto") {
    const rows: { id: string; name: string; free?: boolean }[] =
      choice.source === "openrouter"
        ? openRouterCatalog(rerender).map((m) => ({ id: m.id.replace(/^openrouter\//, ""), name: m.name, free: m.free }))
        : ollamaCatalog(rerender).map((m) => ({ id: m, name: m }));
    const search = h("input", { type: "search", placeholder: rows.length ? `Search ${rows.length} models…` : "Loading models…", "aria-label": "Search models" });
    const list = h("div", { class: "ma-models", role: "listbox" });
    const paint = () => {
      const q = search.value.trim().toLowerCase();
      list.replaceChildren(
        ...rows
          .filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
          .slice(0, 120)
          .map((m) =>
            h(
              "button",
              {
                type: "button",
                role: "option",
                class: `ma-model-row${choice.model === m.id ? " on" : ""}`,
                "aria-selected": String(choice.model === m.id),
                onclick: () => {
                  choice.model = m.id;
                  save();
                },
              },
              h("span", {}, m.name),
              choice.source === "openrouter"
                ? m.free
                  ? h("em", { class: "ma-free" }, "free")
                  : h("em", {}, "your key")
                : h("em", { class: BEST.has(m.id) ? "ma-free" : "" }, `${BEST.has(m.id) ? "★ best · " : ""}${ollamaSpeed.has(m.id) ? `${(ollamaSpeed.get(m.id)! / 1000).toFixed(1)} s` : ""}`),
            ),
          ),
      );
    };
    search.addEventListener("input", paint);
    paint();
    body.append(
      h("p", { class: "set-current" }, choice.model ? `Using ${choice.model}` : "Pick a model below. Until you do, Focus chooses for you."),
      search,
      list,
    );
  }

  return h("section", { class: "card set-card" }, h("h3", { class: "set-title" }, title), h("p", { class: "page-lede set-lede" }, lede), seg, hint, body);
}


/* ---------- internet, device and skills ---------- */

const sw = (on: boolean, label: string, onChange: (on: boolean) => void): HTMLButtonElement => {
  const b = h("button", { class: "switch", type: "button", role: "switch", "aria-checked": String(on), "aria-label": label });
  b.addEventListener("click", () => {
    const next = b.getAttribute("aria-checked") !== "true";
    b.setAttribute("aria-checked", String(next));
    onChange(next);
  });
  return b;
};

const row = (title: string, hint: string, control: Node): HTMLElement =>
  h("div", { class: "set-row" }, h("div", { class: "set-row-text" }, h("strong", {}, title), h("small", {}, hint)), control);

function toolsSection(ctx: Ctx): HTMLElement {
  const t = ctx.state.settings.tools;
  const save = () => {
    ctx.persist();
    setToolsConfig(t);
  };
  const status = h("p", { class: "field-hint set-hint", role: "status" });
  const url = h("input", { type: "text", value: t.bridge.url, placeholder: "http://127.0.0.1:7788", "aria-label": "Device address", autocapitalize: "off", spellcheck: "false" });
  const key = h("input", { type: "password", value: t.bridge.token, placeholder: "Device key", "aria-label": "Device key", autocomplete: "off" });
  url.addEventListener("input", () => ((t.bridge.url = url.value.trim()), save()));
  key.addEventListener("input", () => ((t.bridge.token = key.value.trim()), save()));
  const test = h("button", { class: "btn-ghost sm", type: "button" }, "Test the connection");
  test.addEventListener("click", async () => {
    status.textContent = "Connecting…";
    try {
      const res = await fetch(`${t.bridge.url.replace(/\/$/, "")}/ping`, { headers: { "x-focus-token": t.bridge.token } });
      const d = (await res.json()) as { ok?: boolean; root?: string; shell?: boolean; control?: boolean; error?: string };
      status.textContent = d.ok ? `Connected. Folder: ${d.root}. Control: ${d.control ? "on" : "off"}. Commands: ${d.shell ? "on" : "off"}.` : d.error || "The key isn't right.";
    } catch {
      status.textContent = "Can't reach it. Is the program running on that device?";
    }
  });
  const steps = h(
    "details",
    { class: "set-steps" },
    h("summary", {}, "How to connect a computer or a phone"),
    h("p", {}, "1. Install Node.js (nodejs.org). On Android install the Termux app, then run: pkg install nodejs"),
    h("p", {}, "2. Download the small program: ", h("a", { href: "/focus-bridge.mjs", download: "focus-bridge.mjs" }, "focus-bridge.mjs")),
    h("p", {}, "3. Run it: node focus-bridge.mjs   (add --root ~/Documents to limit it to one folder, and --shell to let Focus run commands)"),
    h("p", {}, "4. Paste the address and key it prints here, then switch the connection on. It only listens on that device."),
    h("p", {}, "Then just ask: “open YouTube”, “copy this to my clipboard”, “remind me with a notification”, “take a screenshot”, “find my report about Friday”. On Android also install the Termux:API app and run: pkg install termux-api"),
  );
  return h(
    "section",
    { class: "card set-card" },
    h("h3", { class: "set-title" }, "Internet and devices"),
    h("p", { class: "page-lede set-lede" }, "What Focus may use while it answers. It asks a tool only when the question needs it."),
    ...(import.meta.env.VITE_ARTIFACT === "1" ? [h("p", { class: "field-hint set-hint" }, "The internet and device tools work in the full app at focus-agents.vercel.app; this Artifact has no server for them.")] : []),
    row("Internet", "Search the web and read pages, then answer with sources.", sw(t.web, "Internet access", (on) => ((t.web = on), save()))),
    row("My location", "Use the position of this device (the browser asks you).", sw(t.location, "Location", (on) => ((t.location = on), save()))),
    row("Computer or phone", "Look through a folder on a device and find what's needed.", sw(t.bridge.on, "Device connection", (on) => ((t.bridge.on = on), save()))),
    h("div", { class: "set-body" }, url, key),
    row("Control the device", "Open apps and links, use the clipboard, show notifications, type text and take screenshots. You approve each action.", sw(t.bridge.control !== false, "Control the device", (on) => ((t.bridge.control = on), save()))),
    row("Allow commands", "Focus may run commands there; you approve each one.", sw(t.bridge.shell, "Allow commands", (on) => ((t.bridge.shell = on), save()))),
    h("div", { class: "set-actions" }, test),
    status,
    steps,
  );
}

function skillsSection(ctx: Ctx, rerender: () => void): HTMLElement {
  const st = ctx.state;
  const on = (id: string) => st.settings.skills.includes(id);
  const flip = (id: string, v: boolean) => {
    st.settings.skills = v ? [...new Set([...st.settings.skills, id])] : st.settings.skills.filter((x) => x !== id);
    ctx.persist();
  };
  const card = (k: Skill): HTMLElement => {
    const body = h("div", { class: "set-skill-body" });
    if (!k.builtIn) {
      const name = h("input", { type: "text", value: k.name, placeholder: "Name", "aria-label": "Skill name" });
      const desc = h("input", { type: "text", value: k.description, placeholder: "Short description", "aria-label": "Skill description" });
      const text = h("textarea", { rows: 4, placeholder: "What Focus should always do when this skill is on.", "aria-label": "Skill instructions" });
      text.value = k.instructions;
      name.addEventListener("input", () => ((k.name = name.value), ctx.persist()));
      desc.addEventListener("input", () => ((k.description = desc.value), ctx.persist()));
      text.addEventListener("input", () => ((k.instructions = text.value), ctx.persist()));
      body.append(name, desc, text, h("button", { class: "btn-ghost sm danger", type: "button", onclick: () => ((st.skills = st.skills.filter((x) => x.id !== k.id)), (st.settings.skills = st.settings.skills.filter((x) => x !== k.id)), ctx.persist(), rerender()) }, "Delete"));
    } else body.append(h("p", { class: "field-hint" }, k.description));
    return h("details", { class: "set-skill" }, h("summary", {}, h("span", { class: "set-skill-name" }, k.name || "Untitled skill"), sw(on(k.id), `${k.name} in every chat`, (v) => flip(k.id, v))), body);
  };
  const add = h("button", { class: "btn sm", type: "button" }, "New skill");
  add.addEventListener("click", () => {
    st.skills.push({ id: uid(), name: "", description: "", instructions: "" });
    ctx.persist();
    rerender();
  });
  return h(
    "section",
    { class: "card set-card" },
    h("h3", { class: "set-title" }, "Skills"),
    h("p", { class: "page-lede set-lede" }, "Short sets of instructions. Switch a skill on and Focus follows it in every chat. Open one to read it; write your own below."),
    ...allSkills(st).map(card),
    add,
  );
}

type Tab = "general" | "models" | "tools" | "skills";
let tab: Tab = "general";

export function renderSettings(main: HTMLElement, ctx: Ctx): void {
  const rerender = () => renderSettings(main, ctx);
  const inArtifact = import.meta.env.VITE_ARTIFACT === "1";
  const body = h("div", { class: "set-tab-body" });
  const paint = () => {
    if (tab === "general")
      body.replaceChildren(
        accountSection(rerender),
        h(
          "section",
          { class: "card set-card" },
          h("h3", { class: "set-title" }, "Language"),
          slideSeg<Lang>([{ value: "en", label: "English" }, { value: "ru", label: "Русский" }], getLang(), (v) => setLang(v), "Interface language"),
        ),
        h(
          "section",
          { class: "card set-card" },
          h("h3", { class: "set-title" }, "Chat"),
          row(
            "Aeronus team",
            "Put Claude, GPT, Gemini and your other agents on one task. When it's on, switch between Focus and Aeronus from the model button in the chat.",
            sw(!!ctx.state.settings.teamMode, "Aeronus team", (on) => {
              ctx.state.settings.teamMode = on;
              if (!on) ctx.state.config.hub = "focus";
              ctx.persist();
            }),
          ),
        ),
      );
    else if (tab === "models")
      body.replaceChildren(
        h("p", { class: "page-lede" }, inArtifact ? "In this Artifact chats run through Claude, so the model choice below applies to the full app at focus-agents.vercel.app." : "Choose which model answers your chats. Change it any time; it applies to new messages."),
        h(
          "div",
          { class: "set-update" },
          h("button", { class: "btn", type: "button", onclick: () => void updateModels(rerender) }, "Update models"),
          h("span", { class: "field-hint" }, updateNote || (liveModelsAt() ? "Lists are up to date." : "Focus keeps its model lists fresh: retired models drop out and new free ones join.")),
        ),
        section(ctx, "focus", "Focus chat", "The single assistant (Storm, GEN, Clorus) answers with this model.", rerender),
        section(ctx, "aeronus", "Aeronus chat", "Every team member that runs on Focus's free connection answers with this model. Agents with their own key keep theirs.", rerender),
      );
    else if (tab === "tools") body.replaceChildren(toolsSection(ctx));
    else body.replaceChildren(skillsSection(ctx, rerender));
  };
  const tabs = slideSeg<Tab>(
    [
      { value: "general", label: "General" },
      { value: "models", label: "Models" },
      { value: "tools", label: "Devices" },
      { value: "skills", label: "Skills" },
    ],
    tab,
    (v) => {
      tab = v;
      paint();
      body.classList.remove("swap");
      void body.offsetWidth;
      body.classList.add("swap");
    },
    "Settings section",
  );
  tabs.classList.add("set-tabs");
  paint();
  main.replaceChildren(pageHead("Settings"), h("div", { class: "page" }, h("div", { class: "page-inner" }, tabs, body)));
}
