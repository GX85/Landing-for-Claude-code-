import type { Ctx } from "./app";
import { h, pageHead } from "./dom";
import { openRouterCatalog, resetCatalog } from "./pages";
import { liveModelsAt, refreshLiveModels } from "./api";
import type { ModelChoice, ModelSource } from "./store";

/** Settings: which model answers in Focus and which in Aeronus. */

let ollamaModels: string[] | undefined;
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
    fetch("/api/models?ollama=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no list"))))
      .then((d: { models?: string[] }) => {
        ollamaModels = d.models?.length ? d.models : OLLAMA_FALLBACK;
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
  { id: "auto", label: "Auto", hint: "Focus picks the best free model for each message." },
  { id: "openrouter", label: "OpenRouter", hint: "Any of about 460 OpenRouter models. Free ones cost nothing; others use your OpenRouter key from Connections." },
  { id: "ollama", label: "Ollama", hint: "Ollama Cloud models, served through Focus. If one is busy, Focus falls back to its free models." },
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
              choice.source === "openrouter" ? (m.free ? h("em", { class: "ma-free" }, "free") : h("em", {}, "your key")) : null,
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

export function renderSettings(main: HTMLElement, ctx: Ctx): void {
  const rerender = () => renderSettings(main, ctx);
  const inArtifact = import.meta.env.VITE_ARTIFACT === "1";
  main.replaceChildren(
    pageHead("Settings"),
    h(
      "div",
      { class: "page" },
      h(
        "div",
        { class: "page-inner" },
        h("p", { class: "page-lede" }, inArtifact ? "In this Artifact chats run through Claude, so the model choice below applies to the full app at focus-agents.vercel.app." : "Choose which model answers your chats. Change it any time; it applies to new messages."),
        h(
          "div",
          { class: "set-update" },
          h("button", { class: "btn", type: "button", onclick: () => void updateModels(rerender) }, "Update models"),
          h("span", { class: "field-hint" }, updateNote || (liveModelsAt() ? "Lists are up to date." : "Focus keeps its model lists fresh: retired models drop out and new free ones join.")),
        ),
        section(ctx, "focus", "Focus chat", "The single assistant (Storm, GEN, Clorus) answers with this model.", rerender),
        section(ctx, "aeronus", "Aeronus chat", "Every team member that runs on Focus's free connection answers with this model. Agents with their own key keep theirs.", rerender),
      ),
    ),
  );
}
