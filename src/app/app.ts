import { trackViewport } from "./viewport";
import { signedInUser, signOut } from "./signin";
import { renderMyAgents } from "./myagents";
import { applyHub, focusMark } from "./brand";
import "./app.css";
import "./hub.css";
import "@fontsource/playfair-display/latin-900.css";
import type { Route } from "../router";
import { renderChat, isRunning } from "./chat";
import { h, icon, relativeDay } from "./dom";
import { renderAgents, renderConnections, renderModes } from "./pages";
import { isReady, load, save, type State } from "./store";

export type Go = (to: Route | string, opts?: { replace?: boolean }) => void;

export interface Ctx {
  state: State;
  /** Saves soon; call after any change. */
  persist: () => void;
  go: Go;
  refreshSidebar: () => void;
  route: Route;
}

const state = load();
let saveTimer = 0;
const persist = () => {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => save(state), 250);
};
addEventListener("beforeunload", () => save(state));

let root: HTMLElement | undefined;
let side: HTMLElement;
let chatsEl: HTMLElement;
let footEl: HTMLElement;
let main: HTMLElement;
let searchInput: HTMLInputElement;
let ctx: Ctx;

function navLink(label: string, iconName: string, to: Route, active: boolean): HTMLAnchorElement {
  const path = to.name === "chat" ? "/app" : `/app/${to.name}`;
  return h(
    "a",
    {
      class: `side-link${active ? " active" : ""}`,
      href: path,
      onclick: (e) => {
        const ev = e as MouseEvent;
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
        e.preventDefault();
        closeDrawer();
        ctx.go(to);
      },
    },
    icon(iconName),
    h("span", {}, label),
  );
}

function mount(el: HTMLElement): void {
  root = el;
  trackViewport(el);
  searchInput = h("input", { type: "search", placeholder: "Search chats", "aria-label": "Search chats", oninput: () => renderChats() });
  chatsEl = h("div", { class: "side-chats" });
  footEl = h("div", { class: "side-foot" });
  side = h("aside", { class: "side", "aria-label": "Sidebar" });
  main = h("main", { class: "main" });
  const scrim = h("div", { class: "scrim", onclick: closeDrawer });
  root.replaceChildren(h("div", { class: `shell${state.sidebarCollapsed ? " collapsed" : ""}` }, side, scrim, main));
  ctx = { state, persist, go: () => undefined, refreshSidebar: renderSidebar, route: { name: "chat" } };

  // glass catches the light where the pointer is
  if (matchMedia("(hover: hover)").matches) {
    root.addEventListener("pointermove", (e) => {
      const el = (e.target as Element).closest<HTMLElement>(".side, .composer, .popover");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      el.style.setProperty("--my", `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
    });
  }

  main.addEventListener("click", (e) => {
    const action = (e.target as Element).closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "toggle-sidebar") toggleSidebar();
    if (action === "new-chat") ctx.go({ name: "chat" });
  });

  addEventListener("keydown", (e) => {
    if (root?.hidden) return;
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
      e.preventDefault();
      ctx.go({ name: "chat" });
    }
    if (e.key === "Escape") closeDrawer();
  });
}

export function toggleSidebar(): void {
  const shell = root!.querySelector(".shell")!;
  if (matchMedia("(max-width: 860px)").matches) {
    shell.classList.toggle("drawer-open");
    return;
  }
  state.sidebarCollapsed = !state.sidebarCollapsed;
  shell.classList.toggle("collapsed", state.sidebarCollapsed);
  persist();
}

function closeDrawer(): void {
  root?.querySelector(".shell")?.classList.remove("drawer-open");
}

function renderSidebar(): void {
  const r = ctx.route;
  side.replaceChildren(
    h(
      "div",
      { class: "side-top" },
      h(
        "a",
        {
          class: "brand",
          href: "/",
          title: "Focus home",
          onclick: (e) => {
            e.preventDefault();
            ctx.go({ name: "landing" });
          },
        },
        focusMark(22),
        "Focus",
      ),
      h("button", { class: "icon-btn", type: "button", title: "Close sidebar", "aria-label": "Close sidebar", onclick: toggleSidebar }, icon("sidebar")),
    ),
    navLink("New chat", "compose", { name: "chat" }, r.name === "chat" && !r.id),
    h("label", { class: "side-search" }, icon("search", 16), searchInput),
    h(
      "nav",
      { class: "side-nav", "aria-label": "Sections" },
      navLink("Agents", "agents", { name: "builder" }, r.name === "builder"),
      navLink("Team", "council", { name: "agents" }, r.name === "agents"),
      navLink("Connections", "key", { name: "connections" }, r.name === "connections"),
      navLink("Modes", "modes", { name: "modes" }, r.name === "modes"),
    ),
    chatsEl,
    footEl,
  );
  renderChats();
  const ready = state.agents.filter((a) => isReady(state, a)).length;
  const user = signedInUser();
  footEl.replaceChildren(
    h(
      "a",
      {
        class: `side-status${ready ? "" : " warn"}`,
        href: "/app/connections",
        onclick: (e) => {
          e.preventDefault();
          closeDrawer();
          ctx.go({ name: ready ? "agents" : "connections" });
        },
      },
      h("span", { class: "status-dot" }),
      ready ? `${ready} agent${ready === 1 ? "" : "s"} ready` : "Add an API key to start",
    ),
    ...(user
      ? [h(
          "div",
          { class: "side-user" },
          user.avatar ? h("img", { src: user.avatar, alt: "", width: 22, height: 22 }) : h("span", { class: "avatar xs", style: "background:#1d1d1d" }, user.name.slice(0, 1).toUpperCase()),
          h("span", { class: "side-user-name", title: user.email ?? user.name }, user.name),
          h("button", { class: "btn-ghost sm", type: "button", onclick: () => void signOut() }, "Sign out"),
        )]
      : []),
  );
}

function renderChats(): void {
  const q = searchInput.value.trim().toLowerCase();
  const list = [...state.chats]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)));
  const activeId = ctx.route.name === "chat" ? ctx.route.id : undefined;
  const groups = new Map<string, HTMLElement[]>();
  for (const chat of list) {
    const label = relativeDay(chat.updatedAt);
    const item = h(
      "div",
      { class: `chat-item${chat.id === activeId ? " active" : ""}` },
      h(
        "a",
        {
          href: `/app/c/${chat.id}`,
          onclick: (e) => {
            e.preventDefault();
            closeDrawer();
            ctx.go({ name: "chat", id: chat.id });
          },
        },
        isRunning(chat.id) ? h("span", { class: "spinner sm", "aria-label": "Working" }) : null,
        h("span", { class: "chat-title" }, chat.title || "New chat"),
      ),
      h(
        "button",
        {
          class: "icon-btn sm",
          type: "button",
          title: "Rename",
          "aria-label": `Rename ${chat.title}`,
          onclick: () => {
            const title = prompt("Rename chat", chat.title)?.trim();
            if (!title) return;
            chat.title = title;
            persist();
            renderSidebar();
            if (activeId === chat.id) ctx.go({ name: "chat", id: chat.id }, { replace: true });
          },
        },
        icon("edit", 15),
      ),
      h(
        "button",
        {
          class: "icon-btn sm",
          type: "button",
          title: "Delete",
          "aria-label": `Delete ${chat.title}`,
          onclick: () => {
            if (!confirm(`Delete “${chat.title}”?`)) return;
            state.chats = state.chats.filter((c) => c !== chat);
            persist();
            if (activeId === chat.id) ctx.go({ name: "chat" }, { replace: true });
            else renderSidebar();
          },
        },
        icon("trash", 15),
      ),
    );
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  chatsEl.replaceChildren(
    ...[...groups].flatMap(([label, items]) => [h("div", { class: "side-group" }, label), ...items]),
    list.length ? "" : h("div", { class: "side-empty" }, q ? "No chats match." : "Your chats will appear here."),
  );
}

/** Shows the app at `route`. Mounts the shell on first use. */
export function show(el: HTMLElement, route: Route, go: Go): void {
  if (root !== el) mount(el);
  ctx.go = go;
  ctx.route = route;
  renderSidebar();
  applyHub(state.config.hub ?? "focus");
  main.scrollTop = 0;
  switch (route.name) {
    case "builder":
      document.title = "Agents · Focus";
      renderMyAgents(main, ctx, route.id);
      break;
    case "agents":
      document.title = "Team · Focus";
      renderAgents(main, ctx);
      break;
    case "connections":
      document.title = "Connections · Focus";
      renderConnections(main, ctx);
      break;
    case "modes":
      document.title = "Modes · Focus";
      renderModes(main, ctx);
      break;
    default: {
      const chat = route.name === "chat" && route.id ? state.chats.find((c) => c.id === route.id) : undefined;
      if (route.name === "chat" && route.id && !chat) {
        go({ name: "chat" }, { replace: true });
        return;
      }
      document.title = chat ? `${chat.title} · Focus` : "Focus";
      renderChat(main, ctx, chat);
    }
  }
}

export function unmount(): void {
  closeDrawer();
}
