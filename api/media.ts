import { requireUser } from "./_lib/auth.js";
import { errorResponse, parseAgent, readJson, UserError } from "./_lib/providers.js";
import { fetchMedia } from "./_lib/jobs.js";

/** POST /api/media — streams a generated file that needs the connection's key to download. */
export default {
  async fetch(request: Request): Promise<Response> {
    const denied = requireUser(request);
    if (denied) return denied;
    try {
      const body = await readJson(request);
      const agent = parseAgent(body.agent);
      if (typeof body.url !== "string") throw new UserError("Missing url.");
      const upstream = await fetchMedia(agent, body.url);
      if (!upstream.ok || !upstream.body) throw new UserError(`The file isn't available (${upstream.status}). It may have expired.`, 502);
      return new Response(upstream.body, {
        headers: { "content-type": upstream.headers.get("content-type") ?? "application/octet-stream", "cache-control": "private, max-age=3600" },
      });
    } catch (error) {
      return errorResponse(error);
    }
  },
};
