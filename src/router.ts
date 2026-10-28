export type Route =
  | { name: "landing" }
  | { name: "chat"; id?: string }
  | { name: "agents" }
  | { name: "connections" }
  | { name: "modes" };

export function parseRoute(path: string): Route {
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts[0] !== "app") return { name: "landing" };
  if (parts[1] === "c" && parts[2]) return { name: "chat", id: decodeURIComponent(parts[2]) };
  if (parts[1] === "agents" || parts[1] === "connections" || parts[1] === "modes") return { name: parts[1] };
  return { name: "chat" };
}

export function routePath(route: Route): string {
  switch (route.name) {
    case "landing":
      return "/";
    case "chat":
      return route.id ? `/app/c/${encodeURIComponent(route.id)}` : "/app";
    default:
      return `/app/${route.name}`;
  }
}
