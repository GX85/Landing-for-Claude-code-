export type Route =
  | { name: "landing" }
  | { name: "chat"; id?: string }
  | { name: "agents" }
  | { name: "builder"; id?: string }
  | { name: "connections" }
  | { name: "modes" };

export function parseRoute(path: string): Route {
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts[0] !== "app") return { name: "landing" };
  if (parts[1] === "c" && parts[2]) return { name: "chat", id: decodeURIComponent(parts[2]) };
  if (parts[1] === "my-agents") return { name: "builder", id: parts[2] ? decodeURIComponent(parts[2]) : undefined };
  if (parts[1] === "team" || parts[1] === "agents") return { name: "agents" };
  if (parts[1] === "connections" || parts[1] === "modes") return { name: parts[1] };
  return { name: "chat" };
}

export function routePath(route: Route): string {
  switch (route.name) {
    case "landing":
      return "/";
    case "chat":
      return route.id ? `/app/c/${encodeURIComponent(route.id)}` : "/app";
    case "builder":
      return route.id ? `/app/my-agents/${encodeURIComponent(route.id)}` : "/app/my-agents";
    case "agents":
      return "/app/team";
    default:
      return `/app/${route.name}`;
  }
}
