import type { Ctx } from "./app";
import { h, icon, pageHead } from "./dom";
import { agentMascot } from "../mascot";
import { openRouterCatalog, type OrModel } from "./pages";
import { AGENT_COLORS, allSkills, newFocusAgent, TIER_ORDER, TIERS, type FocusAgent, type Tier } from "./store";

/**
 * Agents you build in Focus: a name and a look, who the agent is, which model it runs on
 * and how it thinks. Every change saves on its own; "Start chat" talks to the agent.
 */

const BRAIN = ["Auto", "Quick", "Think", "Deep", "UltraVision"];
const BRAIN_HINT = [
  "Decides per message: quick replies to small talk, deep thinking for hard questions.",
  "Answers right away and keeps it short.",
  "Thinks it through before answering.",
  "Reasons step by step and checks its work.",
  "Writes a draft, reviews it like a strict editor and rewrites it. Slowest, sharpest.",
];
const STYLE: { id: FocusAgent["style"]; label: string }[] = [
  { id: "short", label: "Short" },
  { id: "balanced", label: "Balanced" },
  { id: "detailed", label: "Detailed" },
];
const PRESETS: { name: string; text: string }[] = [
  { name: "Tutor", text: "A patient tutor. Explains step by step with examples, checks understanding with a quick question, never just hands over answers to homework." },
  { name: "Coder", text: "A senior engineer. Writes clean, working code with short explanations, points out bugs and edge cases, prefers simple solutions." },
  { name: "Copywriter", text: "A sharp copywriter. Writes punchy headlines and clear, persuasive text, offers three variants, avoids clichés." },
  { name: "Startup coach", text: "A blunt startup coach. Asks about customers and numbers, finds the riskiest assumption, gives concrete next steps for this week." },
  { name: "Translator", text: "A careful translator. Keeps meaning, tone and idioms natural in the target language; asks which language if unclear." },
  { name: "Comedian", text: "A stand-up comedian. Answers helpfully but with jokes, puns and playful exaggeration, never mean." },
];

export function renderMyAgents(main: HTMLElement, ctx: Ctx, id?: string): void {
  const { state } = ctx;
  const agent = id ? state.focusAgents.find((a) => a.id === id) : undefined;
  if (id && !agent) return ctx.go({ name: "builder" }, { replace: true });
  main.replaceChildren(pageHead(agent ? agent.name || "Agent" : "Agents"), h("div", { class: "page" }, h("div", { class: "page-inner ma" }, agent ? editor(ctx, agent) : gallery(ctx))));
}

/* ---------- the list ---------- */

function gallery(ctx: Ctx): HTMLElement {
  const { state } = ctx;
  const create = () => {
    const a = newFocusAgent(state.focusAgents.length + 1);
    state.focusAgents.push(a);
    ctx.persist();
    ctx.go({ name: "builder", id: a.id });
  };
  return h(
    "div",
    {},
    h("p", { class: "page-lede" }, "Build your own agent: give it a look, a personality and a way of thinking, and pick any of the 460 models on OpenRouter, or let Focus choose a free one."),
    h(
      "div",
      { class: "ma-grid" },
      h("button", { class: "ma-card ma-new", type: "button", onclick: create }, h("span", { class: "ma-plus" }, icon("plus", 26)), h("b", {}, "New agent"), h("small", {}, "Start from scratch")),
      ...state.focusAgents.map((a) =>
        h(
          "div",
          { class: "ma-card" },
          h("button", { class: "ma-open", type: "button", "aria-label": `Edit ${a.name}`, onclick: () => ctx.go({ name: "builder", id: a.id }) }, agentMascot(a.color, 56), h("b", {}, a.name || "Untitled"), h("small", {}, modelLabel(a))),
          h("button", { class: "btn sm ma-chat", type: "button", onclick: () => startChat(ctx, a) }, "Chat"),
        ),
      ),
    ),
  );
}

const modelLabel = (a: FocusAgent) => (a.model ? a.model.replace(/:free$/, " · free") : `Focus picks · ${TIERS[a.tier].name}`);

function startChat(ctx: Ctx, a: FocusAgent): void {
  ctx.state.config = { ...ctx.state.config, hub: "focus", agentId: a.id };
  ctx.persist();
  ctx.go({ name: "chat" });
}

/* ---------- the editor ---------- */

function editor(ctx: Ctx, a: FocusAgent): HTMLElement {
  const save = () => {
    ctx.persist();
    paintPreview();
  };

  // preview
  const pvMascot = h("div", { class: "ma-pv-mascot" });
  const pvName = h("h2", { class: "ma-pv-name" });
  const pvModel = h("p", { class: "ma-pv-model" });
  const pvStarters = h("div", { class: "ma-pv-starters" });
  const paintPreview = () => {
    pvMascot.replaceChildren(agentMascot(a.color, 112));
    pvName.textContent = a.name || "Untitled";
    pvModel.textContent = `${modelLabel(a)} · ${BRAIN[a.think] ?? "Auto"}`;
    pvStarters.replaceChildren(...a.starters.filter((s) => s.trim()).map((s) => h("span", {}, s)));
  };
  paintPreview();
  const preview = h(
    "aside",
    { class: "ma-preview" },
    pvMascot,
    pvName,
    pvModel,
    pvStarters,
    h("button", { class: "btn ma-start", type: "button", onclick: () => startChat(ctx, a) }, "Start chat"),
    h("button", { class: "btn-ghost sm", type: "button", onclick: () => ctx.go({ name: "builder" }) }, "← All agents"),
  );

  // name and look
  const nameInput = h("input", {
    value: a.name,
    maxlength: 40,
    placeholder: "Name your agent",
    oninput: (e) => {
      a.name = (e.target as HTMLInputElement).value;
      const title = document.querySelector(".main-head .head-title");
      if (title) title.textContent = a.name || "Agent";
      save();
    },
  });
  const swatches = h(
    "div",
    { class: "swatches ma-swatches" },
    ...AGENT_COLORS.map((c) =>
      h("button", { class: `swatch${c === a.color ? " selected" : ""}`, type: "button", style: `background:${c}`, "aria-label": `Colour ${c}`, onclick: (e: Event) => pick(c, e.currentTarget as HTMLElement) }),
    ),
    h("label", { class: "swatch ma-custom", title: "Any colour" }, h("input", { type: "color", value: a.color.length === 7 ? a.color : "#ffffff", oninput: (e) => pick((e.target as HTMLInputElement).value) })),
  );
  const pick = (c: string, el?: HTMLElement) => {
    a.color = c;
    swatches.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("selected", s === el));
    save();
  };

  // personality
  const who = h("textarea", { rows: 5, maxlength: 4000, placeholder: "Who is this agent? How should it talk, what does it know, what should it never do?", oninput: (e) => ((a.instructions = (e.target as HTMLTextAreaElement).value), save()) }, a.instructions);
  const presets = h(
    "div",
    { class: "presets" },
    ...PRESETS.map((p) =>
      h(
        "button",
        {
          class: "preset",
          type: "button",
          onclick: () => {
            a.instructions = p.text;
            who.value = p.text;
            if (/^Agent \d+$/.test(a.name)) {
              a.name = p.name;
              nameInput.value = p.name;
            }
            save();
          },
        },
        p.name,
      ),
    ),
  );

  // model
  const modelBox = modelPicker(a, save);

  // brainstorm level
  const brainHint = h("p", { class: "field-hint" }, BRAIN_HINT[a.think] ?? BRAIN_HINT[0]);
  const brainRange = h("input", { type: "range", min: 0, max: 4, step: 1, value: String(a.think), class: "think-range", "aria-label": "Brainstorm level" });
  const brainMarks = h("div", { class: "think-marks" }, ...BRAIN.map((n, i) => h("button", { type: "button", "data-i": String(i), onclick: () => setBrain(i) }, i === 4 ? "Ultra" : n)));
  const setBrain = (i: number) => {
    a.think = i;
    brainRange.value = String(i);
    brainRange.style.setProperty("--pn", String(i / 4));
    brainHint.textContent = BRAIN_HINT[i];
    brainMarks.querySelectorAll<HTMLElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.i === String(i)));
    save();
  };
  brainRange.addEventListener("input", () => setBrain(Number(brainRange.value)));
  setBrain(a.think);

  // creativity
  const creative = h("input", { type: "range", min: 0, max: 100, step: 5, value: String(Math.round(a.creativity * 100)), class: "think-range", "aria-label": "Creativity" });
  const paintCreative = () => creative.style.setProperty("--pn", String(Number(creative.value) / 100));
  creative.addEventListener("input", () => {
    a.creativity = Number(creative.value) / 100;
    paintCreative();
    save();
  });
  paintCreative();

  // style
  const style = h(
    "div",
    { class: "ma-seg", role: "radiogroup" },
    ...STYLE.map((s) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          "aria-checked": String(a.style === s.id),
          onclick: (e: Event) => {
            a.style = s.id;
            (e.currentTarget as HTMLElement).parentElement!.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b === e.currentTarget)));
            save();
          },
        },
        s.label,
      ),
    ),
  );

  // skills
  const skills = h(
    "span",
    { class: "presets" },
    ...allSkills(ctx.state).map((sk) =>
      h(
        "button",
        {
          class: `preset${a.skills.includes(sk.id) ? " on" : ""}`,
          type: "button",
          title: sk.description,
          onclick: (e: Event) => {
            const on = !a.skills.includes(sk.id);
            a.skills = on ? [...a.skills, sk.id] : a.skills.filter((x) => x !== sk.id);
            (e.currentTarget as HTMLElement).classList.toggle("on", on);
            save();
          },
        },
        sk.name,
      ),
    ),
  );

  // starters
  const starters = h(
    "div",
    { class: "ma-starters" },
    ...[0, 1, 2, 3].map((i) =>
      h("input", {
        value: a.starters[i] ?? "",
        maxlength: 120,
        placeholder: i === 0 ? "e.g. Explain quantum computing simply" : "Another thing people might ask",
        oninput: (e) => {
          a.starters[i] = (e.target as HTMLInputElement).value;
          a.starters = a.starters.map((s) => s ?? "");
          save();
        },
      }),
    ),
  );

  const field = (label: string, ...nodes: (Node | string)[]) => h("div", { class: "field" }, h("span", { class: "field-label" }, label), ...nodes);

  const form = h(
    "div",
    { class: "ma-form" },
    field("Name", nameInput),
    field("Look", swatches),
    field("Who is it?", who, presets),
    field("Model", modelBox),
    field("Brainstorm level", brainRange, brainMarks, brainHint),
    field("Creativity", creative, h("div", { class: "ma-ends" }, h("span", {}, "Precise"), h("span", {}, "Inventive"))),
    field("Answers", style),
    field("Skills", skills),
    field("Conversation starters", starters),
    h(
      "div",
      { class: "card-actions" },
      h("span", { class: "spacer" }),
      h(
        "button",
        {
          class: "btn-ghost sm danger",
          type: "button",
          onclick: () => {
            if (!confirm(`Delete ${a.name || "this agent"}?`)) return;
            ctx.state.focusAgents = ctx.state.focusAgents.filter((x) => x !== a);
            if (ctx.state.config.agentId === a.id) ctx.state.config.agentId = undefined;
            ctx.persist();
            ctx.go({ name: "builder" });
          },
        },
        "Delete agent",
      ),
    ),
  );

  return h("div", { class: "ma-editor" }, preview, form);
}

/** Focus picks by tier, or any OpenRouter model from a searchable list. */
function modelPicker(a: FocusAgent, save: () => void): HTMLElement {
  const box = h("div", { class: "ma-model" });
  const render = () => {
    const catalog = openRouterCatalog(render);
    const search = h("input", { type: "search", placeholder: catalog.length ? `Search ${catalog.length} models…` : "Loading models…", "aria-label": "Search models" });
    const list = h("div", { class: "ma-models", role: "listbox" });
    const tiers = h(
      "div",
      { class: "ma-seg" },
      ...TIER_ORDER.map((t: Tier) =>
        h(
          "button",
          {
            type: "button",
            class: `tier-${t}`,
            "aria-checked": String(!a.model && a.tier === t),
            onclick: () => {
              a.model = "";
              a.tier = t;
              save();
              render();
            },
          },
          TIERS[t].name,
        ),
      ),
    );
    const paintList = () => {
      const q = search.value.trim().toLowerCase();
      const shown = catalog.filter((m: OrModel) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)).slice(0, 120);
      list.replaceChildren(
        ...shown.map((m) => {
          const id = m.id.replace(/^openrouter\//, "");
          return h(
            "button",
            {
              type: "button",
              role: "option",
              class: `ma-model-row${a.model === id ? " on" : ""}`,
              "aria-selected": String(a.model === id),
              onclick: () => {
                a.model = id;
                save();
                render();
              },
            },
            h("span", {}, m.name),
            m.free ? h("em", { class: "ma-free" }, "free") : h("em", {}, "your key"),
          );
        }),
      );
    };
    search.addEventListener("input", paintList);
    paintList();
    box.replaceChildren(
      h("p", { class: "field-hint" }, "Let Focus pick a free model:"),
      tiers,
      h("p", { class: "field-hint" }, a.model ? `Runs on ${a.model}. If it's busy, Focus answers with its free models instead.` : "Or choose a specific model. Free ones work for everyone; others use your OpenRouter key from Connections."),
      search,
      list,
    );
  };
  render();
  return box;
}
