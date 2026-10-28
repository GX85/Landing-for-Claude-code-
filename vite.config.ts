import { defineConfig, type Plugin } from "vite";
import { Readable } from "node:stream";

/** Serves the Vercel functions in `api/` during `npm run dev`, streaming included. */
function devApi(): Plugin {
  return {
    name: "focus-dev-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/(run|models|job|media)(\?.*)?$/);
        if (!match) return next();
        const abort = new AbortController();
        res.on("close", () => abort.abort());
        try {
          const mod = await server.ssrLoadModule(`/api/${match[1]}.ts`);
          const request = new Request(new URL(req.url!, "http://localhost"), {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: req.method === "GET" || req.method === "HEAD" ? undefined : (Readable.toWeb(req) as ReadableStream),
            duplex: "half",
            signal: abort.signal,
          } as RequestInit);
          const response: Response = await mod.default.fetch(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.flushHeaders();
          if (response.body) {
            for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
          }
          res.end();
        } catch (error) {
          if (!res.headersSent) next(error);
          else res.end();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [devApi()],
});
