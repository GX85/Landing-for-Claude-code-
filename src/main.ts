import { hideLanding, showLanding } from "./landing";
import { parseRoute, routePath, type Route } from "./router";

const appRoot = document.getElementById("app")!;
let app: typeof import("./app/app") | undefined;
const loadApp = () => import("./app/app");

/** Switches between the landing and the app without reloading the page. */
export async function navigate(to: Route | string, { replace = false } = {}): Promise<void> {
  const path = typeof to === "string" ? to : routePath(to);
  if (path !== location.pathname) history[replace ? "replaceState" : "pushState"](null, "", path);
  await apply(parseRoute(path));
}

let current: Route["name"] | undefined;

async function apply(route: Route): Promise<void> {
  if (route.name === "landing") {
    app?.unmount();
    appRoot.hidden = true;
    document.title = "Focus";
    if (current !== "landing") void showLanding((path) => void navigate(path));
    current = route.name;
    return;
  }

  app ??= await loadApp();
  if (current === "landing" || current === undefined) {
    hideLanding();
    appRoot.hidden = false;
    appRoot.classList.remove("app-enter");
    void appRoot.offsetWidth; // restart the entrance animation
    appRoot.classList.add("app-enter");
  }
  current = route.name;
  app.show(appRoot, route, (to, opts) => void navigate(to, opts));
}

addEventListener("popstate", () => void apply(parseRoute(location.pathname)));
// the landing manages its own scroll position
history.scrollRestoration = "manual";

void apply(parseRoute(location.pathname));

// warm the app bundle while the landing plays
if (parseRoute(location.pathname).name === "landing") {
  const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500));
  idle(() => void loadApp());
}
