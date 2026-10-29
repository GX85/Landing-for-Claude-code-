import type { Ctx } from "./app";
import { fetchModels } from "./api";
import { h, icon, pageHead } from "./dom";
import { MODES } from "./modes";
import { agentAvatar } from "./brand";
import {
  allSkills,
  COLORS,
  FREE_MODELS,
  freeModelLabel,
  uid,
  type Skill,
  connectionOf,
  KIND_LABEL,
  modelsFor,
  setModels,
  type AgentKind,
  type ProviderGroup,
  missing,
  newAgent,
  newConnection,
  PROVIDERS,
  ROLE_PRESETS,
  type Agent,
  type Connection,
  type Effort,
  type Provider,
} from "./store";

function field(label: string, control: Node, hint?: Node | string | null): HTMLLabelElement {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, hint ? h("span", { class: "field-hint" }, hint) : null);
}

function page(main: HTMLElement, title: string, lede: string, ...content: Node[]): void {
  main.replaceChildren(pageHead(title), h("div", { class: "page" }, h("div", { class: "page-inner" }, h("p", { class: "page-lede" }, lede), ...content)));
}

function toggle(checked: boolean, label: string, onChange: (on: boolean) => void): HTMLButtonElement {
  const btn = h("button", { class: "switch", type: "button", role: "switch", "aria-checked": String(checked), "aria-label": label });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const on = btn.getAttribute("aria-checked") !== "true";
    btn.setAttribute("aria-checked", String(on));
    onChange(on);
  });
  return btn;
}

/* ---------- agents ---------- */

export interface OrModel {
  id: string;
  name: string;
  free: boolean;
}
let orModels: OrModel[] | undefined;
let orLoading = false;

/** OpenRouter's public model list, loaded once; the page re-renders when it arrives. */
export function openRouterCatalog(onLoad: () => void): OrModel[] {
  if (orModels) return orModels;
  if (!orLoading) {
    orLoading = true;
    fetch("https://openrouter.ai/api/v1/models")
      .then((r) => r.json())
      .then((d: { data: { id: string; name: string; architecture?: { output_modalities?: string[] } }[] }) => {
        orModels = d.data
          .filter((m) => !m.architecture?.output_modalities || m.architecture.output_modalities.includes("text"))
          .map((m) => ({ id: `openrouter/${m.id}`, name: m.name.replace(/\s*\(free\)$/i, ""), free: m.id.endsWith(":free") }))
          .sort((a, b) => a.name.localeCompare(b.name));
        onLoad();
      })
      .catch(() => (orLoading = false));
  }
  return [];
}

const openAgents = new Set<string>();

export function renderAgents(main: HTMLElement, ctx: Ctx): void {
  const { state } = ctx;
  const listEl = h("div", { class: "cards" });

  const rerender = () => {
    ctx.persist();
    ctx.refreshSidebar();
    renderAgents(main, ctx);
  };

  const card = (agent: Agent, index: number): HTMLElement => {
    const conn = connectionOf(state, agent);
    const problem = missing(state, agent);
    const update = (patch: Partial<Agent>, full = false) => {
      Object.assign(agent, patch);
      ctx.persist();
      if (full) rerender();
      else {
        el.querySelector(".card-name")!.textContent = agent.name || "Untitled";
        ctx.refreshSidebar();
      }
    };

    const info = conn ? PROVIDERS[conn.provider] : undefined;
    const isChat = agent.kind === "chat";
    const models = h("datalist", { id: `models-${agent.id}` }, ...modelsFor(conn, agent.kind).map((m) => h("option", { value: m })));
    const modelInput = h("input", {
      value: agent.model,
      list: models.id,
      placeholder: info?.models[agent.kind] || (info?.needsModel || isChat ? "model id" : "optional"),
      spellcheck: "false",
      autocomplete: "off",
      oninput: (e) => update({ model: (e.target as HTMLInputElement).value.trim() }),
      onchange: () => rerender(),
    });
    const loadBtn = h("button", { class: "btn-ghost sm", type: "button" }, "Load models");
    loadBtn.addEventListener("click", async () => {
      if (!conn) return;
      loadBtn.textContent = "Loading…";
      loadBtn.disabled = true;
      try {
        const list = await fetchModels(conn, agent.kind);
        setModels(conn, agent.kind, list);
        ctx.persist();
        models.replaceChildren(...list.map((m) => h("option", { value: m })));
        loadBtn.textContent = `${list.length} ${conn.provider === "jules" ? "repos" : "models"}`;
        modelInput.focus();
        try {
          modelInput.showPicker?.();
        } catch {
          // the list still opens on typing
        }
      } catch (error) {
        loadBtn.textContent = "Load models";
        alert(error instanceof Error ? error.message : String(error));
      } finally {
        loadBtn.disabled = false;
      }
    });

    const roleInput = h(
      "textarea",
      { rows: 3, placeholder: "How this agent should think and behave.", oninput: (e) => update({ role: (e.target as HTMLTextAreaElement).value }) },
      agent.role,
    );

    const userOr = state.connections.find((c) => c.provider === "openrouter" && c.apiKey);
    const catalog = openRouterCatalog(() => renderAgents(main, ctx));
    const freeOr = catalog.filter((m) => m.free);
    const paidOr = userOr ? catalog.filter((m) => !m.free) : [];
    const known = new Set([...FREE_MODELS.map((m) => m.id), ...catalog.map((m) => m.id)]);
    const opt = (id: string, label: string) => h("option", { value: id, selected: id === agent.model }, label);
    const freeSelect = h(
      "select",
      { onchange: (e) => update({ model: (e.target as HTMLSelectElement).value }, true) },
      h("optgroup", { label: "No key · runs in your browser" }, ...FREE_MODELS.map((m) => opt(m.id, `${m.label} — ${m.note}`))),
      freeOr.length ? h("optgroup", { label: `Free on OpenRouter · ${freeOr.length} models` }, ...freeOr.map((m) => opt(m.id, m.name))) : null,
      paidOr.length ? h("optgroup", { label: `All OpenRouter models · ${paidOr.length} · billed to your key` }, ...paidOr.map((m) => opt(m.id, m.name))) : null,
      agent.model && !known.has(agent.model) ? opt(agent.model, freeModelLabel(agent.model)) : null,
    );
    const freeHint = userOr
      ? `${catalog.length || "All"} OpenRouter models are listed. The free ones cost nothing; others are billed to your OpenRouter key.`
      : h("span", {}, "OpenRouter has about 460 models, but only the ones marked free cost nothing. Free OpenRouter models use Focus's server key when it has one, or ", h("a", { href: "/app/connections" }, "add your own free OpenRouter key"), " to unlock all of them.");

    const skillChips = h(
      "span",
      { class: "presets" },
      ...allSkills(state).map((sk) =>
        h(
          "button",
          {
            class: `preset${agent.skills.includes(sk.id) ? " on" : ""}`,
            type: "button",
            title: sk.description,
            "aria-pressed": String(agent.skills.includes(sk.id)),
            onclick: (e: Event) => {
              const on = !agent.skills.includes(sk.id);
              agent.skills = on ? [...agent.skills, sk.id] : agent.skills.filter((x) => x !== sk.id);
              const btn = e.currentTarget as HTMLElement;
              btn.classList.toggle("on", on);
              btn.setAttribute("aria-pressed", String(on));
              ctx.persist();
            },
          },
          sk.name,
        ),
      ),
    );

    const move = (delta: number) => {
      const to = index + delta;
      if (to < 0 || to >= state.agents.length) return;
      [state.agents[index], state.agents[to]] = [state.agents[to], state.agents[index]];
      rerender();
    };

    const el = h(
      "details",
      { class: `card agent-card${agent.enabled ? "" : " off"}`, open: openAgents.has(agent.id) },
      h(
        "summary",
        { class: "card-head" },
        agentAvatar("", agent, conn?.provider),
        h(
          "span",
          { class: "card-title" },
          h("span", { class: "card-name" }, agent.name || "Untitled"),
          h(
            "span",
            { class: "card-sub" },
            conn ? `${isChat ? "" : `${KIND_LABEL[agent.kind]} · `}${PROVIDERS[conn.provider].label}${agent.model ? ` · ${conn.provider === "focus" ? freeModelLabel(agent.model) : agent.model}` : ""}` : "No connection",
            problem ? h("span", { class: "warn" }, ` · ${problem}`) : "",
          ),
        ),
        toggle(agent.enabled, `Use ${agent.name}`, (on) => update({ enabled: on }, true)),
        icon("chevron", 16),
      ),
      h(
        "div",
        { class: "card-body" },
        h(
          "div",
          { class: "grid-2" },
          field("Name", h("input", { value: agent.name, oninput: (e) => update({ name: (e.target as HTMLInputElement).value }), onchange: () => rerender() })),
          field(
            "Connection",
            h(
              "select",
              {
                onchange: (e) => {
                  const id = (e.target as HTMLSelectElement).value;
                  if (id === "__new") return ctx.go({ name: "connections" });
                  const next = PROVIDERS[state.connections.find((c) => c.id === id)!.provider];
                  const kind = next.kinds.includes(agent.kind) ? agent.kind : next.kinds[0];
                  update({ connectionId: id, kind, model: next.models[kind] ?? "", effort: id && next === PROVIDERS.anthropic ? "high" : "" }, true);
                },
              },
              ...state.connections.map((c) => h("option", { value: c.id, selected: c.id === agent.connectionId }, c.name)),
              h("option", { value: "__new" }, "Add a connection…"),
            ),
          ),
        ),
        info && info.kinds.length > 1
          ? field(
              "Type",
              h(
                "select",
                {
                  onchange: (e) => {
                    const kind = (e.target as HTMLSelectElement).value as AgentKind;
                    update({ kind, model: info.models[kind] ?? "" }, true);
                  },
                },
                ...info.kinds.map((k) => h("option", { value: k, selected: k === agent.kind }, KIND_LABEL[k])),
              ),
              agent.kind === "chat" ? null : `${KIND_LABEL[agent.kind]} agents turn the message (or, in Relay, the previous agent's text) into ${agent.kind === "agent" ? "a task" : `a${agent.kind === "image" ? "n image" : " video"}`}.`,
            )
          : null,
        conn?.provider === "focus" && isChat
          ? field("Free model", freeSelect, freeHint)
          : info?.modelLabel === "—"
          ? null
          : field(
              isChat ? "Model" : (info?.modelLabel ?? "Model"),
              h("div", { class: "inline" }, modelInput, conn && !["webhook", "devin"].includes(conn.provider) && !info?.builtIn ? loadBtn : null, models),
              conn?.provider === "anthropic" ? "Default: claude-opus-5-5. Load models to see everything your key can use." : conn?.provider === "openrouter" && isChat ? "Load models: the free ones (ending in :free) come first." : null,
            ),
        isChat && conn && !["webhook"].includes(conn.provider)
          ? field(
              "Effort",
              h(
                "select",
                { onchange: (e) => update({ effort: (e.target as HTMLSelectElement).value as Effort }) },
                ...(["", "low", "medium", "high", "xhigh", "max"] as Effort[]).map((v) => h("option", { value: v, selected: v === agent.effort }, v || "model default")),
              ),
              EFFORT_HINT[conn.provider] ?? "How hard the model thinks before answering. Models without a thinking setting ignore it.",
            )
          : null,
        isChat ? field("Skills", skillChips, h("span", {}, "Extra instructions this agent always follows. ", h("a", { href: "#skills" }, "Write your own"), ".")) : null,
        !isChat
          ? null
          : field(
          "Role",
          roleInput,
          h(
            "span",
            { class: "presets" },
            ...ROLE_PRESETS.map((p) =>
              h(
                "button",
                {
                  class: "preset",
                  type: "button",
                  onclick: () => {
                    roleInput.value = p.role;
                    update({ role: p.role });
                  },
                },
                p.name,
              ),
            ),
          ),
        ),
        h(
          "div",
          { class: "field" },
          h("span", { class: "field-label" }, "Avatar and color"),
          h("input", {
            class: "avatar-input",
            value: agent.avatar,
            maxlength: 4,
            placeholder: agent.name.slice(0, 1) || "A",
            "aria-label": "Avatar: one or two letters or an emoji",
            oninput: (e) => update({ avatar: (e.target as HTMLInputElement).value.trim() }),
            onchange: () => rerender(),
          }),
          h(
            "div",
            { class: "swatches" },
            ...COLORS.map((c) =>
              h("button", {
                class: `swatch${c === agent.color ? " selected" : ""}`,
                type: "button",
                style: `background:${c}`,
                "aria-label": `Color ${c}`,
                onclick: () => update({ color: c }, true),
              }),
            ),
          ),
        ),
        h(
          "div",
          { class: "card-actions" },
          h("button", { class: "icon-btn", type: "button", title: "Move up", "aria-label": "Move up", disabled: index === 0, onclick: () => move(-1) }, "↑"),
          h("button", { class: "icon-btn", type: "button", title: "Move down", "aria-label": "Move down", disabled: index === state.agents.length - 1, onclick: () => move(1) }, "↓"),
          h("span", { class: "spacer" }),
          h(
            "button",
            {
              class: "btn-ghost sm",
              type: "button",
              onclick: () => {
                const copy = { ...agent, id: Math.random().toString(36).slice(2, 10), name: `${agent.name} 2` };
                state.agents.splice(index + 1, 0, copy);
                state.config.agentIds.push(copy.id);
                openAgents.add(copy.id);
                rerender();
              },
            },
            "Duplicate",
          ),
          h(
            "button",
            {
              class: "btn-ghost sm danger",
              type: "button",
              onclick: () => {
                if (!confirm(`Remove ${agent.name}?`)) return;
                state.agents = state.agents.filter((a) => a !== agent);
                rerender();
              },
            },
            "Remove",
          ),
        ),
      ),
    );
    el.addEventListener("toggle", () => (el.open ? openAgents.add(agent.id) : openAgents.delete(agent.id)));
    return el;
  };

  listEl.append(...state.agents.map(card));

  const addCustom = () => {
    const conn = state.connections.find((c) => c.provider === "focus") ?? state.connections.find((c) => PROVIDERS[c.provider].kinds.includes("chat"));
    if (!conn) return ctx.go({ name: "connections" });
    const agent = newAgent(conn, "chat");
    agent.name = `Agent ${state.agents.length + 1}`;
    agent.color = COLORS[state.agents.length % COLORS.length];
    state.agents.push(agent);
    state.config.agentIds.push(agent.id);
    openAgents.add(agent.id);
    rerender();
    requestAnimationFrame(() => {
      const card = main.querySelector<HTMLElement>(".agent-card:last-of-type");
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      card?.querySelector<HTMLInputElement>(".card-body input")?.select();
    });
  };

  const addMenu = h(
    "div",
    { class: "add-row" },
    h("button", { class: "btn sm", type: "button", onclick: addCustom }, icon("plus", 14), "Custom agent"),
    ...state.connections.flatMap((c) =>
      PROVIDERS[c.provider].kinds.map((kind) => {
        const base = ["custom", "webhook"].includes(c.provider) ? c.name : PROVIDERS[c.provider].agentName;
        return h(
          "button",
          {
            class: "btn-ghost sm",
            type: "button",
            onclick: () => {
              const agent = newAgent(c, kind);
              if (["custom", "webhook"].includes(c.provider)) agent.name = c.name;
              if (state.agents.some((a) => a.name === agent.name)) agent.name = `${agent.name} ${state.agents.filter((a) => a.name.startsWith(agent.name)).length + 1}`;
              state.agents.push(agent);
              if (kind === "chat") state.config.agentIds.push(agent.id);
              openAgents.add(agent.id);
              rerender();
            },
          },
          icon(kind === "chat" ? "plus" : kind === "agent" ? "agents" : kind === "video" ? "video" : "image", 14),
          kind === "chat" || PROVIDERS[c.provider].kinds.length === 1 ? base : `${base} ${KIND_LABEL[kind].toLowerCase()}`,
        );
      }),
    ),
  );

  page(
    main,
    "Agents",
    "Your team. Each agent is a model with a name and a role; you can have several agents on the same model, like a writer and a critic. The order here is the order in Relay.",
    listEl,
    h("h2", { class: "section-title" }, "Add an agent"),
    h("p", { class: "section-lede" }, "Start from scratch with a custom agent — give it any name, avatar, role, skills and model — or start from a connection below."),
    addMenu,
    h("h2", { class: "section-title", id: "skills" }, "Skills"),
    h("p", { class: "section-lede" }, "A skill is a set of instructions you can give to any chat agent: open an agent and tap a skill to turn it on. Focus comes with ten; write your own here."),
    skillsSection(ctx, rerender),
  );
}

const openSkills = new Set<string>();

function skillsSection(ctx: Ctx, rerender: () => void): HTMLElement {
  const { state } = ctx;
  const card = (sk: Skill): HTMLElement => {
    const users = state.agents.filter((a) => a.skills.includes(sk.id)).map((a) => a.name);
    const sub = `${sk.builtIn ? "Built in" : "Yours"}${users.length ? ` · used by ${users.join(", ")}` : ""}`;
    if (sk.builtIn)
      return h(
        "details",
        { class: "card skill-card" },
        h("summary", { class: "card-head" }, h("span", { class: "card-title" }, h("span", { class: "card-name" }, sk.name), h("span", { class: "card-sub" }, `${sk.description} · ${sub}`)), icon("chevron", 16)),
        h("div", { class: "card-body" }, h("p", { class: "skill-text" }, sk.instructions)),
      );
    const update = (patch: Partial<Skill>) => {
      Object.assign(sk, patch);
      ctx.persist();
    };
    const el = h(
      "details",
      { class: "card skill-card", open: openSkills.has(sk.id) },
      h("summary", { class: "card-head" }, h("span", { class: "card-title" }, h("span", { class: "card-name" }, sk.name || "Untitled skill"), h("span", { class: "card-sub" }, sub)), icon("chevron", 16)),
      h(
        "div",
        { class: "card-body" },
        field("Name", h("input", { value: sk.name, oninput: (e) => update({ name: (e.target as HTMLInputElement).value }), onchange: rerender })),
        field("Short description", h("input", { value: sk.description, placeholder: "Shown when you hover the skill", oninput: (e) => update({ description: (e.target as HTMLInputElement).value }) })),
        field(
          "Instructions",
          h("textarea", { rows: 4, placeholder: "What the agent should always do when it has this skill.", oninput: (e) => update({ instructions: (e.target as HTMLTextAreaElement).value }) }, sk.instructions),
        ),
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
                if (!confirm(`Remove the skill “${sk.name}”?`)) return;
                state.skills = state.skills.filter((x) => x !== sk);
                for (const a of state.agents) a.skills = a.skills.filter((x) => x !== sk.id);
                rerender();
              },
            },
            "Remove",
          ),
        ),
      ),
    );
    el.addEventListener("toggle", () => (el.open ? openSkills.add(sk.id) : openSkills.delete(sk.id)));
    return el;
  };
  return h(
    "div",
    {},
    h("div", { class: "cards" }, ...[...state.skills, ...allSkills({}).filter((x) => x.builtIn)].map(card)),
    h(
      "div",
      { class: "add-row" },
      h(
        "button",
        {
          class: "btn-ghost sm",
          type: "button",
          onclick: () => {
            const sk: Skill = { id: `sk-${uid()}`, name: "New skill", description: "", instructions: "" };
            state.skills.push(sk);
            openSkills.add(sk.id);
            rerender();
          },
        },
        icon("plus", 14),
        "New skill",
      ),
    ),
  );
}

const EFFORT_HINT: Partial<Record<Provider, string>> = {
  anthropic: "Higher effort thinks longer and costs more.",
  openai: "Sent as reasoning effort to reasoning models (o-series, GPT-5); others ignore it.",
  xai: "Sent as reasoning effort; Grok models that can't use it ignore it.",
  mistral: "Sent as reasoning effort to Mistral models that can think.",
  qwen: "Sent as reasoning effort to Qwen models that can think.",
  openrouter: "Sent as reasoning effort to models that support thinking.",
  gemini: "Sets the thinking budget for Gemini 2.5 and newer.",
  focus: "Free models mostly ignore it; it matters for the OpenRouter ones that can think.",
};

/* ---------- connections ---------- */

const WEBHOOK_DOC = `POST <your URL>
Authorization: Bearer <token>        (if you set one)
{ "task": "...", "system": "...", "model": "...", "history": [...], "images": ["data:image/png;base64,…"] }

Reply with plain text, or JSON:
{ "output": "text", "video_url": "https://…/clip.mp4" }`;

const GROUPS: { id: ProviderGroup; title: string; note: string }[] = [
  { id: "free", title: "Free", note: "Focus's own free model needs nothing. OpenRouter has free models with a free account; Ollama runs models on your computer." },
  { id: "chat", title: "Chat models", note: "Your own keys for the big model providers." },
  { id: "media", title: "Video & image generators", note: "Gemini (Veo, Imagen) and OpenAI (images) use the keys above. These add more video and image models." },
  { id: "agents", title: "Autonomous agents", note: "Agents that work on their own for minutes or hours — browsing, coding, opening pull requests. Focus starts the task and follows it until it's done." },
];

export function renderConnections(main: HTMLElement, ctx: Ctx): void {
  const { state } = ctx;

  const card = (conn: Connection): HTMLElement => {
    const info = PROVIDERS[conn.provider];
    const used = state.agents.filter((a) => a.connectionId === conn.id).map((a) => a.name);
    const head = (status: Node) =>
      h(
        "div",
        { class: "card-head static" },
        agentAvatar("", { color: info.color, name: conn.name }, conn.provider),
        h("span", { class: "card-title" }, h("span", { class: "card-name" }, conn.name), h("span", { class: "card-sub" }, used.length ? `Used by ${used.join(", ")}` : info.label)),
        status,
      );

    if (info.builtIn) {
      return h("section", { class: "card conn-card" }, head(h("span", { class: "conn-status ok" }, "Free · no key needed")), h("div", { class: "card-body" }, h("p", { class: "field-hint" }, info.hint ?? "")));
    }

    const status = h("span", { class: "conn-status" });
    const kindForTest: AgentKind = info.kinds[0];
    const setStatus = () => {
      const ok = (!info.needsKey || conn.apiKey) && (!info.needsUrl || conn.baseUrl);
      const n = modelsFor(conn, kindForTest).length;
      status.className = `conn-status${ok ? " ok" : ""}`;
      status.textContent = ok ? (n ? `Connected · ${n} ${conn.provider === "jules" ? "repos" : "models"}` : info.needsKey ? "Key added" : "Ready") : info.needsUrl && !conn.baseUrl ? `Needs ${info.urlLabel?.toLowerCase() ?? "URL"}` : "Needs key";
    };
    setStatus();
    const update = (patch: Partial<Connection>) => {
      Object.assign(conn, patch);
      ctx.persist();
      ctx.refreshSidebar();
      setStatus();
    };

    const keyInput = h("input", {
      type: "password",
      value: conn.apiKey,
      placeholder: info.keyPlaceholder,
      autocomplete: "off",
      spellcheck: "false",
      oninput: (e) => update({ apiKey: (e.target as HTMLInputElement).value.trim(), models: [], mediaModels: {} }),
    });
    const show = h("button", { class: "btn-ghost sm", type: "button" }, "Show");
    show.addEventListener("click", () => {
      keyInput.type = keyInput.type === "password" ? "text" : "password";
      show.textContent = keyInput.type === "password" ? "Show" : "Hide";
    });
    const canTest = !["webhook", "devin", "manus", "luma"].includes(conn.provider);
    const test = h("button", { class: "btn sm", type: "button" }, "Test");
    test.addEventListener("click", async () => {
      test.disabled = true;
      test.textContent = "Testing…";
      try {
        setModels(conn, kindForTest, await fetchModels(conn, kindForTest));
        update({});
      } catch (error) {
        status.className = "conn-status err";
        status.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        test.disabled = false;
        test.textContent = "Test";
      }
    });

    const removable = !["anthropic", "openai", "gemini", "xai", "mistral", "qwen", "devin", "manus", "jules"].includes(conn.provider) || state.connections.filter((c) => c.provider === conn.provider).length > 1;

    return h(
      "section",
      { class: "card conn-card" },
      head(status),
      h(
        "div",
        { class: "card-body" },
        conn.provider === "custom" || conn.provider === "webhook"
          ? field("Name", h("input", { value: conn.name, oninput: (e) => update({ name: (e.target as HTMLInputElement).value }) }))
          : null,
        info.needsUrl || info.local
          ? field(
              info.urlLabel ?? "URL",
              h("input", {
                type: conn.provider === "devin" ? "text" : "url",
                value: conn.baseUrl,
                placeholder: info.urlPlaceholder,
                spellcheck: "false",
                oninput: (e) => update({ baseUrl: (e.target as HTMLInputElement).value.trim(), models: [] }),
              }),
            )
          : null,
        info.local
          ? h("div", { class: "inline" }, canTest ? test : null)
          : field(
              conn.provider === "webhook" ? "Token" : "API key",
              h("div", { class: "inline" }, keyInput, show, canTest ? test : null),
              info.keyUrl ? h("span", {}, "Get a key at ", h("a", { href: info.keyUrl, target: "_blank", rel: "noopener" }, new URL(info.keyUrl).host)) : null,
            ),
        info.hint ? h("p", { class: "field-hint" }, info.hint) : null,
        conn.provider === "webhook" ? h("pre", { class: "doc" }, WEBHOOK_DOC) : null,
        removable
          ? h(
              "div",
              { class: "card-actions" },
              h("span", { class: "spacer" }),
              h(
                "button",
                {
                  class: "btn-ghost sm danger",
                  type: "button",
                  onclick: () => {
                    if (!confirm(`Remove ${conn.name}?${used.length ? ` ${used.join(", ")} will need another connection.` : ""}`)) return;
                    state.connections = state.connections.filter((c) => c !== conn);
                    ctx.persist();
                    ctx.refreshSidebar();
                    renderConnections(main, ctx);
                  },
                },
                "Remove",
              ),
            )
          : null,
      ),
    );
  };

  const addButton = (p: Provider) =>
    h(
      "button",
      {
        class: "btn-ghost sm",
        type: "button",
        onclick: () => {
          const conn = newConnection(p);
          state.connections.push(conn);
          const agent = newAgent(conn);
          state.agents.push(agent);
          if (agent.kind === "chat") state.config.agentIds.push(agent.id);
          ctx.persist();
          ctx.refreshSidebar();
          renderConnections(main, ctx);
          main.querySelector<HTMLElement>(`[data-conn="${conn.id}"] input`)?.focus();
        },
      },
      icon("plus", 14),
      PROVIDERS[p].label,
    );

  const sections = GROUPS.map((g) => {
    const conns = state.connections.filter((c) => PROVIDERS[c.provider].group === g.id);
    const addable = (Object.keys(PROVIDERS) as Provider[]).filter(
      (p) => PROVIDERS[p].group === g.id && !PROVIDERS[p].builtIn && (["custom", "webhook"].includes(p) || !conns.some((c) => c.provider === p)),
    );
    return h(
      "section",
      { class: "conn-group" },
      h("h2", { class: "section-title" }, g.title),
      h("p", { class: "page-note" }, g.note),
      h(
        "div",
        { class: "cards" },
        ...conns.map((c) => {
          const el = card(c);
          el.dataset.conn = c.id;
          return el;
        }),
      ),
      addable.length ? h("div", { class: "add-row" }, ...addable.map(addButton)) : null,
    );
  });

  page(
    main,
    "Connections",
    "Where your agents' models come from. Keys stay in this browser: each request goes through the Focus proxy straight to the provider, and nothing is stored on the server.",
    ...sections,
  );
}

/* ---------- modes ---------- */

export function renderModes(main: HTMLElement, ctx: Ctx): void {
  page(
    main,
    "Modes",
    "How your team works together. Pick a mode in the message box of any chat; each new chat starts with the last one you used.",
    h(
      "div",
      { class: "mode-grid" },
      ...MODES.map((m) =>
        h(
          "article",
          { class: `card mode-card${ctx.state.config.mode === m.id ? " current" : ""}` },
          h("div", { class: "mode-icon" }, icon(m.icon, 22)),
          h("h3", {}, m.name),
          h("p", { class: "mode-short" }, m.description),
          h("ol", { class: "mode-steps" }, ...m.steps.map((s) => h("li", {}, s))),
          h(
            "button",
            {
              class: "btn sm",
              type: "button",
              onclick: () => {
                ctx.state.config.mode = m.id;
                ctx.persist();
                ctx.go({ name: "chat" });
              },
            },
            `New ${m.name} chat`,
          ),
        ),
      ),
    ),
  );
}
