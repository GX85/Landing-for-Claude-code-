import { initI18n } from "./i18n";
import { hideLanding, showLanding } from "./landing";
import { parseRoute, routePath, type Route } from "./router";

const appRoot = document.getElementById("app")!;
const signinRoot = document.body.appendChild(Object.assign(document.createElement("div"), { id: "signin", hidden: true }));
let app: typeof import("./app/app") | undefined;
const loadApp = () => import("./app/app");

/** Switches between the landing and the app without reloading the page. */
export async function navigate(to: Route | string, { replace = false } = {}): Promise<void> {
  const path = typeof to === "string" ? to : routePath(to);
  if (path !== currentPath()) {
    if (ARTIFACT) {
      artifactPath = path;
      // only a plain #name survives in an artifact's address
      const name = path.replace(/^\/app\/?/, "").split("/")[0] || (path.startsWith("/app") ? "app" : "");
      history.replaceState(null, "", name ? `#${name}` : location.pathname);
    } else history[replace ? "replaceState" : "pushState"](null, "", path);
  }
  await apply(parseRoute(path));
}

let current: Route["name"] | undefined;

async function apply(route: Route): Promise<void> {
  if (route.name === "landing") {
    app?.unmount();
    appRoot.hidden = true;
    signinRoot.hidden = true;
    document.title = "Focus";
    if (current !== "landing") void showLanding((path) => void navigate(path));
    current = route.name;
    return;
  }

  const { authInfo, renderSignIn } = await import("./app/signin");
  const auth = await authInfo();
  {
    const api = await import("./app/api");
    api.setServerPool(auth.pool ?? 0);
    api.warmModels();
  }
  if (auth.enabled && !auth.user) {
    hideLanding();
    appRoot.hidden = true;
    current = undefined;
    document.title = "Sign in · Focus";
    signinRoot.hidden = false;
    renderSignIn(signinRoot, auth, () => location.assign("/app"));
    return;
  }
  signinRoot.hidden = true;

  app ??= await loadApp();
  if (current === "landing" || current === undefined) {
    hideLanding();
    appRoot.hidden = false;
    // the window opens out of a hairline: the page behind it keeps the landing's colour instead of flashing white
    document.body.style.background = document.documentElement.classList.contains("light") ? "#f6f5f3" : "#0a0a0c";
    setTimeout(() => (document.body.style.background = ""), 1100);
    appRoot.classList.remove("app-enter");
    void appRoot.offsetWidth; // restart the entrance animation
    appRoot.classList.add("app-enter");
  }
  current = route.name;
  app.show(appRoot, route, (to, opts) => void navigate(to, opts));
}

/** Built as a Claude Artifact: no server, no path routing. */
const ARTIFACT = import.meta.env.VITE_ARTIFACT === "1";
const HASH_ROUTES: Record<string, string> = { app: "/app", agents: "/app/agents", connections: "/app/connections", modes: "/app/modes" };
let artifactPath = HASH_ROUTES[location.hash.slice(1)] ?? "/";
const currentPath = () => (ARTIFACT ? artifactPath : location.pathname);

addEventListener("popstate", () => void apply(parseRoute(currentPath())));
// the landing manages its own scroll position
history.scrollRestoration = "manual";

void initI18n().then(() => apply(parseRoute(currentPath())));

// warm the app bundle while the landing plays
if (parseRoute(currentPath()).name === "landing") {
  const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500));
  idle(() => void loadApp());
}
