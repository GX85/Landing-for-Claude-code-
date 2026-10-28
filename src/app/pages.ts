import type { Ctx } from "./app";
import { fetchModels } from "./api";
import { h, icon, pageHead } from "./dom";
import { MODES } from "./modes";
import {
  COLORS,
  connectionOf,
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

    const models = h("datalist", { id: `models-${agent.id}` }, ...(conn?.models ?? []).map((m) => h("option", { value: m })));
    const modelInput = h("input", {
      value: agent.model,
      list: models.id,
      placeholder: conn?.provider === "webhook" ? "optional" : "model id",
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
        conn.models = await fetchModels(conn);
        ctx.persist();
        models.replaceChildren(...conn.models.map((m) => h("option", { value: m })));
        loadBtn.textContent = `${conn.models.length} models`;
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
        h("span", { class: "avatar", style: `background:${agent.color}` }, agent.name.slice(0, 1)),
        h(
          "span",
          { class: "card-title" },
          h("span", { class: "card-name" }, agent.name || "Untitled"),
          h(
            "span",
            { class: "card-sub" },
            conn ? `${PROVIDERS[conn.provider].label}${agent.model ? ` · ${agent.model}` : ""}` : "No connection",
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
                  const next = state.connections.find((c) => c.id === id)!;
                  update({ connectionId: id, model: PROVIDERS[next.provider].defaultModel, effort: next.provider === "anthropic" ? "high" : "" }, true);
                },
              },
              ...state.connections.map((c) => h("option", { value: c.id, selected: c.id === agent.connectionId }, c.name)),
              h("option", { value: "__new" }, "Add a connection…"),
            ),
          ),
        ),
        field("Model", h("div", { class: "inline" }, modelInput, conn && conn.provider !== "webhook" ? loadBtn : null, models), conn?.provider === "anthropic" ? "Default: claude-opus-5-5. Load models to see everything your key can use." : null),
        conn?.provider === "anthropic"
          ? field(
              "Effort",
              h(
                "select",
                { onchange: (e) => update({ effort: (e.target as HTMLSelectElement).value as Effort }) },
                ...(["", "low", "medium", "high", "xhigh", "max"] as Effort[]).map((v) => h("option", { value: v, selected: v === agent.effort }, v || "model default")),
              ),
              "Higher effort thinks longer and costs more.",
            )
          : null,
        field(
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
          h("span", { class: "field-label" }, "Color"),
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

  const addMenu = h(
    "div",
    { class: "add-row" },
    ...state.connections.map((c) =>
      h(
        "button",
        {
          class: "btn-ghost sm",
          type: "button",
          onclick: () => {
            const agent = newAgent(c);
            if (state.agents.some((a) => a.name === agent.name)) agent.name = `${agent.name} ${state.agents.filter((a) => a.name.startsWith(agent.name)).length + 1}`;
            state.agents.push(agent);
            state.config.agentIds.push(agent.id);
            openAgents.add(agent.id);
            rerender();
          },
        },
        icon("plus", 14),
        `${PROVIDERS[c.provider].agentName === "Custom model" || PROVIDERS[c.provider].agentName === "Agent" ? c.name : PROVIDERS[c.provider].agentName} agent`,
      ),
    ),
  );

  page(
    main,
    "Agents",
    "Your team. Each agent is a model with a name and a role; you can have several agents on the same model, like a writer and a critic. The order here is the order in Relay.",
    listEl,
    h("h2", { class: "section-title" }, "Add an agent"),
    addMenu,
  );
}

/* ---------- connections ---------- */

const WEBHOOK_DOC = `POST <your URL>
Authorization: Bearer <token>        (if you set one)
{ "task": "...", "system": "...", "model": "...", "history": [...] }

Reply with plain text, or JSON:
{ "output": "text", "video_url": "https://…/clip.mp4" }`;

export function renderConnections(main: HTMLElement, ctx: Ctx): void {
  const { state } = ctx;

  const card = (conn: Connection): HTMLElement => {
    const info = PROVIDERS[conn.provider];
    const status = h("span", { class: "conn-status" });
    const setStatus = () => {
      const ok = (!info.needsKey || conn.apiKey) && (!info.needsUrl || conn.baseUrl);
      status.className = `conn-status${ok ? " ok" : ""}`;
      status.textContent = ok ? (conn.models.length ? `Connected · ${conn.models.length} models` : info.needsKey ? "Key added" : "Ready") : info.needsUrl ? "Needs URL" : "Needs key";
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
      oninput: (e) => update({ apiKey: (e.target as HTMLInputElement).value.trim(), models: [] }),
    });
    const show = h("button", { class: "btn-ghost sm", type: "button" }, "Show");
    show.addEventListener("click", () => {
      keyInput.type = keyInput.type === "password" ? "text" : "password";
      show.textContent = keyInput.type === "password" ? "Show" : "Hide";
    });
    const test = h("button", { class: "btn sm", type: "button" }, "Test");
    test.addEventListener("click", async () => {
      test.disabled = true;
      test.textContent = "Testing…";
      try {
        update({ models: await fetchModels(conn) });
        status.textContent = `Connected · ${conn.models.length} models`;
      } catch (error) {
        status.className = "conn-status err";
        status.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        test.disabled = false;
        test.textContent = "Test";
      }
    });
    const used = state.agents.filter((a) => a.connectionId === conn.id).map((a) => a.name);

    return h(
      "section",
      { class: "card conn-card" },
      h(
        "div",
        { class: "card-head static" },
        h("span", { class: "avatar", style: `background:${info.color}` }, conn.name.slice(0, 1)),
        h("span", { class: "card-title" }, h("span", { class: "card-name" }, conn.name), h("span", { class: "card-sub" }, used.length ? `Used by ${used.join(", ")}` : info.label)),
        status,
      ),
      h(
        "div",
        { class: "card-body" },
        conn.provider === "custom" || conn.provider === "webhook"
          ? field("Name", h("input", { value: conn.name, oninput: (e) => update({ name: (e.target as HTMLInputElement).value }) }))
          : null,
        info.needsUrl
          ? field(
              conn.provider === "webhook" ? "Endpoint URL" : "Base URL",
              h("input", { type: "url", value: conn.baseUrl, placeholder: info.urlPlaceholder, spellcheck: "false", oninput: (e) => update({ baseUrl: (e.target as HTMLInputElement).value.trim(), models: [] }) }),
            )
          : null,
        field(
          conn.provider === "webhook" ? "Token" : "API key",
          h("div", { class: "inline" }, keyInput, show, conn.provider === "webhook" ? null : test),
          info.keyUrl ? h("span", {}, "Get a key at ", h("a", { href: info.keyUrl, target: "_blank", rel: "noopener" }, new URL(info.keyUrl).host)) : info.hint,
        ),
        conn.provider === "webhook" ? h("pre", { class: "doc" }, WEBHOOK_DOC) : null,
        conn.provider === "custom" || conn.provider === "webhook" || state.connections.filter((c) => c.provider === conn.provider).length > 1
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

  page(
    main,
    "Connections",
    "Your API keys. They stay in this browser: each request goes through the Focus proxy straight to the provider, and nothing is stored on the server.",
    h("div", { class: "cards" }, ...state.connections.map(card)),
    h("h2", { class: "section-title" }, "Add a connection"),
    h(
      "div",
      { class: "add-row" },
      ...(Object.keys(PROVIDERS) as Provider[]).map((p) =>
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
              state.config.agentIds.push(agent.id);
              ctx.persist();
              ctx.refreshSidebar();
              renderConnections(main, ctx);
              main.querySelector<HTMLElement>(".conn-card:last-of-type input")?.focus();
            },
          },
          icon("plus", 14),
          PROVIDERS[p].label,
        ),
      ),
    ),
    h("p", { class: "page-note" }, "Adding a connection also adds an agent that uses it. Video generators and autonomous agents such as Manus or Jules connect through an HTTP agent: a small endpoint of yours that forwards the task to their API."),
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
