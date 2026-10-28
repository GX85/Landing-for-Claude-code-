import { load, missing, newAgent, PROVIDERS, save, type Agent, type Effort, type Mode, type Provider } from "./store";
import { runTeam, type Step } from "./orchestrator";

const settings = load();
const openCards = new Set<string>();
let controller: AbortController | null = null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const agentsEl = $<HTMLDivElement>("agents");
const addBtn = $<HTMLButtonElement>("add-btn");
const addMenu = $<HTMLDivElement>("add-menu");
const modesEl = $<HTMLDivElement>("modes");
const modeDesc = $<HTMLParagraphElement>("mode-desc");
const modeOpts = $<HTMLDivElement>("mode-opts");
const taskEl = $<HTMLTextAreaElement>("task");
const readyEl = $<HTMLSpanElement>("ready");
const runBtn = $<HTMLButtonElement>("run");
const stopBtn = $<HTMLButtonElement>("stop");
const resultsEl = $<HTMLElement>("results");

/* ---------- tiny DOM helper ---------- */

type Attrs = Record<string, string | boolean | number | ((e: Event) => void) | undefined>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(key.replace(/^on/, ""), value);
    else if (key === "class") el.className = String(value);
    else if (key in el && typeof value !== "string") (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) if (child !== null && child !== false) el.append(child);
  return el;
}

const persist = () => save({ ...settings, task: taskEl.value });
const active = () => settings.agents.filter((a) => a.enabled && !missing(a));

/* ---------- agents ---------- */

function summaryText(agent: Agent): HTMLElement {
  const problem = missing(agent);
  const info = PROVIDERS[agent.provider];
  const what = agent.provider === "webhook" ? info.label : agent.model || info.label;
  return h("div", { class: "agent-sub" }, `${info.label === what ? "" : `${info.label} · `}${what}`, problem ? h("span", { class: "warn" }, ` · ${problem}`) : "");
}

function refreshCard(agent: Agent): void {
  const card = agentsEl.querySelector<HTMLElement>(`[data-id="${agent.id}"]`);
  if (!card) return;
  card.classList.toggle("off", !agent.enabled);
  card.querySelector(".agent-name")!.textContent = agent.name || "Untitled";
  card.querySelector(".agent-sub")!.replaceWith(summaryText(agent));
  refreshReady();
  renderModeOptions();
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  return h("label", { class: "field" }, h("span", {}, label), control);
}

function agentCard(agent: Agent, index: number): HTMLElement {
  const info = PROVIDERS[agent.provider];
  const update = (patch: Partial<Agent>) => {
    Object.assign(agent, patch);
    persist();
    refreshCard(agent);
  };

  const modelList = h("datalist", { id: `models-${agent.id}` });
  const modelInput = h("input", {
    value: agent.model,
    placeholder: agent.provider === "webhook" ? "optional" : "model id",
    list: modelList.id,
    autocomplete: "off",
    spellcheck: "false",
    oninput: (e) => update({ model: (e.target as HTMLInputElement).value.trim() }),
  });
  const loadBtn = h("button", { class: "btn-ghost btn-sm", type: "button", title: "Load the models this key can use" }, "Load");
  loadBtn.addEventListener("click", async () => {
    loadBtn.textContent = "…";
    loadBtn.disabled = true;
    try {
      const res = await fetch("api/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: { provider: agent.provider, apiKey: agent.apiKey, baseUrl: agent.baseUrl } }),
      });
      const data = (await res.json().catch(() => ({}))) as { models?: string[]; error?: string };
      if (!res.ok || !data.models) throw new Error(data.error || "Couldn't load models.");
      modelList.replaceChildren(...data.models.map((m) => h("option", { value: m })));
      loadBtn.textContent = `${data.models.length}`;
      loadBtn.title = `${data.models.length} models — pick one in the model field`;
      modelInput.focus();
      try {
        modelInput.showPicker?.();
      } catch {
        // the list still opens on typing
      }
    } catch (error) {
      loadBtn.textContent = "Load";
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      loadBtn.disabled = false;
    }
  });

  const keyInput = h("input", {
    type: "password",
    value: agent.apiKey,
    placeholder: info.keyPlaceholder,
    autocomplete: "off",
    spellcheck: "false",
    oninput: (e) => update({ apiKey: (e.target as HTMLInputElement).value.trim() }),
  });
  const showKey = h("button", { class: "btn-ghost btn-sm", type: "button" }, "Show");
  showKey.addEventListener("click", () => {
    const hidden = keyInput.type === "password";
    keyInput.type = hidden ? "text" : "password";
    showKey.textContent = hidden ? "Hide" : "Show";
  });

  const providerSelect = h(
    "select",
    {
      onchange: (e) => {
        const provider = (e.target as HTMLSelectElement).value as Provider;
        const fresh = newAgent(provider);
        Object.assign(agent, { provider, model: fresh.model, effort: fresh.effort, baseUrl: "" });
        if (Object.values(PROVIDERS).some((p) => p.defaultName === agent.name)) agent.name = fresh.name;
        persist();
        renderAgents();
      },
    },
    ...Object.entries(PROVIDERS).map(([key, p]) => h("option", { value: key, selected: key === agent.provider }, p.label)),
  );

  const toggle = h("button", {
    class: "switch",
    type: "button",
    role: "switch",
    "aria-checked": String(agent.enabled),
    "aria-label": `Use ${agent.name} in runs`,
  });
  toggle.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle.setAttribute("aria-checked", String(!agent.enabled));
    update({ enabled: !agent.enabled });
  });

  const move = (delta: number) => {
    const list = settings.agents;
    const to = index + delta;
    if (to < 0 || to >= list.length) return;
    [list[index], list[to]] = [list[to], list[index]];
    persist();
    renderAgents();
    renderModeOptions();
  };

  const details = h(
    "details",
    { class: `agent${agent.enabled ? "" : " off"}`, "data-id": agent.id, open: openCards.has(agent.id) },
    h(
      "summary",
      {},
      h("span", { class: "dot", style: `background:${info.color}` }),
      h("div", { class: "agent-title" }, h("div", { class: "agent-name" }, agent.name || "Untitled"), summaryText(agent)),
      toggle,
    ),
    h(
      "div",
      { class: "agent-body" },
      field("Name", h("input", { value: agent.name, oninput: (e) => update({ name: (e.target as HTMLInputElement).value }) })),
      field("Provider", providerSelect),
      info.needsUrl
        ? field(
            agent.provider === "webhook" ? "Endpoint URL" : "Base URL",
            h("input", {
              type: "url",
              value: agent.baseUrl,
              placeholder: info.urlPlaceholder,
              spellcheck: "false",
              oninput: (e) => update({ baseUrl: (e.target as HTMLInputElement).value.trim() }),
            }),
          )
        : null,
      field(agent.provider === "webhook" ? "Token" : "API key", h("div", { class: "inline" }, keyInput, showKey)),
      info.keyUrl ? h("p", { class: "hint" }, "Get a key: ", h("a", { href: info.keyUrl, target: "_blank", rel: "noopener" }, new URL(info.keyUrl).host)) : null,
      field("Model", h("div", { class: "inline" }, modelInput, agent.provider === "webhook" ? "" : loadBtn, modelList)),
      agent.provider === "anthropic"
        ? field(
            "Effort",
            h(
              "select",
              { onchange: (e) => update({ effort: (e.target as HTMLSelectElement).value as Effort }) },
              ...(["", "low", "medium", "high", "xhigh", "max"] as Effort[]).map((v) => h("option", { value: v, selected: v === agent.effort }, v || "model default")),
            ),
          )
        : null,
      field(
        "Role (optional)",
        h("textarea", {
          rows: 2,
          placeholder: "e.g. You are the critic: look for errors and weak spots.",
          oninput: (e) => update({ role: (e.target as HTMLTextAreaElement).value }),
        }, agent.role),
      ),
      info.hint ? h("p", { class: "hint" }, info.hint) : null,
      h(
        "div",
        { class: "agent-actions" },
        h("button", { class: "icon-btn", type: "button", title: "Move up", "aria-label": "Move up", disabled: index === 0, onclick: () => move(-1) }, "↑"),
        h("button", { class: "icon-btn", type: "button", title: "Move down", "aria-label": "Move down", disabled: index === settings.agents.length - 1, onclick: () => move(1) }, "↓"),
        h("span", { class: "spacer" }),
        h(
          "button",
          {
            class: "btn-ghost btn-sm danger",
            type: "button",
            onclick: () => {
              if (!confirm(`Remove ${agent.name || "this agent"}?`)) return;
              settings.agents = settings.agents.filter((a) => a !== agent);
              persist();
              renderAgents();
              renderModeOptions();
            },
          },
          "Remove",
        ),
      ),
    ),
  );
  details.addEventListener("toggle", () => {
    if (details.open) openCards.add(agent.id);
    else openCards.delete(agent.id);
  });
  return details;
}

function renderAgents(): void {
  agentsEl.replaceChildren(...settings.agents.map(agentCard));
  if (!settings.agents.length) agentsEl.append(h("div", { class: "empty" }, "No agents yet. Add one to start."));
  refreshReady();
}

function renderAddMenu(): void {
  addMenu.replaceChildren(
    ...(Object.entries(PROVIDERS) as [Provider, (typeof PROVIDERS)[Provider]][]).map(([key, p]) =>
      h(
        "button",
        {
          type: "button",
          role: "menuitem",
          onclick: () => {
            const agent = newAgent(key);
            settings.agents.push(agent);
            openCards.add(agent.id);
            persist();
            closeMenu();
            renderAgents();
            renderModeOptions();
            agentsEl.querySelector<HTMLElement>(`[data-id="${agent.id}"] input`)?.focus();
          },
        },
        h("span", { class: "dot", style: `background:${p.color}` }),
        key === "custom" || key === "webhook" ? p.label : `${p.defaultName} · ${p.label}`,
      ),
    ),
  );
}

function closeMenu(): void {
  addMenu.hidden = true;
  addBtn.setAttribute("aria-expanded", "false");
}

addBtn.addEventListener("click", () => {
  const open = addMenu.hidden;
  addMenu.hidden = !open;
  addBtn.setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", (e) => {
  if (!addMenu.hidden && !(e.target as Element).closest(".add")) closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});

/* ---------- modes ---------- */

const MODE_TEXT: Record<Mode, string> = {
  council: "Every agent answers on its own, then the lead merges the answers into one.",
  relay: "Agents work in order, top to bottom: each one improves and continues the previous result. Put a video generator last to turn the text into a clip.",
  review: "The first agent drafts, the second reviews it, and the first revises — until the reviewer approves.",
};

function renderModes(): void {
  for (const btn of modesEl.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
    btn.setAttribute("aria-checked", String(btn.dataset.mode === settings.mode));
  }
  modeDesc.textContent = MODE_TEXT[settings.mode];
  renderModeOptions();
}

function renderModeOptions(): void {
  const team = active();
  const names = (list: Agent[]) => list.map((a) => a.name).join(" → ");
  if (!team.length) {
    modeOpts.replaceChildren();
  } else if (settings.mode === "council") {
    const leads = team.filter((a) => a.provider !== "webhook");
    if (!leads.some((a) => a.id === settings.leadId) && leads[0]) settings.leadId = leads[0].id;
    modeOpts.replaceChildren(
      h(
        "label",
        {},
        "Lead",
        h(
          "select",
          { onchange: (e) => ((settings.leadId = (e.target as HTMLSelectElement).value), persist()) },
          ...leads.map((a) => h("option", { value: a.id, selected: a.id === settings.leadId }, a.name)),
        ),
      ),
    );
  } else if (settings.mode === "relay") {
    modeOpts.replaceChildren(`Order: ${names(team)}`);
  } else {
    const [maker, checker] = team;
    modeOpts.replaceChildren(
      maker ? `Maker: ${maker.name}` : "",
      checker ? ` · Reviewer: ${checker.name}` : maker ? " · add a second agent to review" : "",
      h(
        "label",
        {},
        "Rounds",
        h(
          "select",
          { onchange: (e) => ((settings.rounds = Number((e.target as HTMLSelectElement).value)), persist()) },
          ...[1, 2, 3].map((n) => h("option", { value: n, selected: n === settings.rounds }, String(n))),
        ),
      ),
    );
  }
}

modesEl.addEventListener("click", (e) => {
  const mode = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-mode]")?.dataset.mode as Mode | undefined;
  if (!mode) return;
  settings.mode = mode;
  persist();
  renderModes();
});

/* ---------- run ---------- */

function refreshReady(): void {
  const team = active();
  const waiting = settings.agents.filter((a) => a.enabled && missing(a));
  readyEl.textContent = team.length
    ? `${team.length} agent${team.length === 1 ? "" : "s"} ready${waiting.length ? ` · ${waiting.length} not set up` : ""}`
    : "Add an API key and a model to at least one agent.";
  runBtn.disabled = !team.length || !!controller;
}

const seconds = (step: Step) => `${(((step.endedAt ?? Date.now()) - step.startedAt) / 1000).toFixed(1)}s`;

function stepCard(step: Step, isFinal = false): HTMLElement {
  const info = PROVIDERS[step.agent.provider];
  const body: Node[] = [];
  if (step.status === "error") body.push(h("p", { class: "step-body err" }, step.error ?? "Failed."));
  if (step.media && /^https?:/i.test(step.media)) {
    body.push(
      /\.(png|jpe?g|gif|webp)(\?|$)/i.test(step.media)
        ? h("img", { class: "step-media", src: step.media, alt: `Result from ${step.agent.name}` })
        : h("video", { class: "step-media", src: step.media, controls: true, playsinline: true }),
    );
  }
  if (step.status === "done" && step.text && step.text !== step.media) body.push(h("p", { class: "step-body" }, step.text));

  const copy =
    step.status === "done" && step.text
      ? h("button", {
          class: "btn-ghost btn-sm",
          type: "button",
          onclick: async (e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            try {
              await navigator.clipboard.writeText(step.text ?? "");
              btn.textContent = "Copied";
            } catch {
              btn.textContent = "Couldn't copy";
            }
            setTimeout(() => (btn.textContent = "Copy"), 1500);
          },
        }, "Copy")
      : null;

  return h(
    "article",
    { class: `step${isFinal ? " final" : ""}` },
    h(
      "div",
      { class: "step-head" },
      isFinal ? h("span", { class: "final-label" }, "Result") : step.status === "running" ? h("span", { class: "spinner", "aria-label": "Working" }) : h("span", { class: "dot", style: `background:${info.color}` }),
      h("span", { class: "step-who" }, step.agent.name),
      h("span", { class: "step-phase" }, isFinal ? `${step.phase} · ${info.label}` : step.phase),
      h("span", { class: "step-meta", "data-step": step.id }, step.status === "error" ? "failed" : seconds(step)),
      copy,
    ),
    ...body,
  );
}

function renderResults(steps: Step[], final?: Step, done = false, stopped = false): void {
  if (!done) {
    resultsEl.replaceChildren(h("h3", { class: "steps-title" }, "Working…"), ...steps.map((s) => stepCard(s)));
    return;
  }
  const nodes: Node[] = [];
  if (final && !stopped) nodes.push(stepCard(final, true));
  else nodes.push(h("div", { class: "empty" }, stopped ? "Stopped." : "No agent produced a result. Check the errors below."));
  if (steps.length) {
    nodes.push(
      h(
        "details",
        { class: "steps", open: !final || stopped },
        h("summary", {}, `How the team got there · ${steps.length} step${steps.length === 1 ? "" : "s"}`),
        ...steps.map((s) => stepCard(s)),
      ),
    );
  }
  resultsEl.replaceChildren(...nodes);
}

let ticker = 0;
let liveSteps: Step[] = [];

async function run(): Promise<void> {
  const task = taskEl.value.trim();
  const team = active();
  if (!task) {
    taskEl.focus();
    return;
  }
  if (!team.length) return;

  controller = new AbortController();
  runBtn.disabled = true;
  runBtn.textContent = "Running…";
  stopBtn.hidden = false;
  liveSteps = [];
  renderResults([]);
  ticker = window.setInterval(() => {
    for (const step of liveSteps) {
      if (step.status !== "running") continue;
      const meta = resultsEl.querySelector(`[data-step="${step.id}"]`);
      if (meta) meta.textContent = seconds(step);
    }
  }, 200);

  try {
    const outcome = await runTeam(task, {
      mode: settings.mode,
      agents: team,
      leadId: settings.leadId,
      rounds: settings.rounds,
      signal: controller.signal,
      onUpdate: (steps) => {
        liveSteps = steps;
        renderResults(steps);
      },
    });
    renderResults(outcome.steps, outcome.final, true, controller.signal.aborted);
  } catch (error) {
    resultsEl.prepend(h("div", { class: "empty" }, error instanceof Error ? error.message : String(error)));
  } finally {
    clearInterval(ticker);
    controller = null;
    runBtn.textContent = "Run team";
    stopBtn.hidden = true;
    refreshReady();
  }
}

runBtn.addEventListener("click", () => void run());
stopBtn.addEventListener("click", () => controller?.abort());
taskEl.addEventListener("input", persist);
taskEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void run();
});

/* ---------- start ---------- */

taskEl.value = settings.task;
if (!settings.agents.some((a) => !missing(a))) settings.agents.slice(0, 1).forEach((a) => openCards.add(a.id));
renderAddMenu();
renderAgents();
renderModes();
resultsEl.append(
  h(
    "div",
    { class: "empty" },
    "Set up your agents, pick how they work together, and give them a task. ",
    h("br"),
    "Tip: ⌘/Ctrl + Enter runs the team.",
  ),
);
