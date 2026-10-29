import { requireUser } from "./_lib/auth.js";
import { errorResponse, json, listModels, ollamaModels, parseAgent, readJson, UserError } from "./_lib/providers.js";

/** POST /api/models — lists the models the user's key can use. */
export default {
  async fetch(request: Request): Promise<Response> {
    const denied = requireUser(request);
    if (denied) return denied;
    try {
      // the Ollama Cloud models Focus can run with its own key (Settings)
      if (new URL(request.url).searchParams.has("ollama")) return json({ models: await ollamaModels() });
      const agent = parseAgent((await readJson(request)).agent);
      if (!agent.apiKey && !["custom", "focus", "pollinations", "luma", "replicate", "manus", "webhook"].includes(agent.provider)) throw new UserError("Add an API key first.");
      return json({ models: await listModels(agent) });
    } catch (error) {
      return errorResponse(error);
    }
  },
};
