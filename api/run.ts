import { errorResponse, json, parseAgent, readJson, runAgent, UserError } from "./_lib/providers.js";

const MAX_PROMPT_CHARS = 400_000;

/**
 * POST /api/run — one call to one agent.
 * The browser sends the agent's settings (including the user's own API key) with
 * each request; nothing is stored or logged here.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const body = await readJson(request);
      const agent = parseAgent(body.agent);
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      const system = typeof body.system === "string" ? body.system.slice(0, 20_000) : undefined;

      if (!prompt.trim()) throw new UserError("The task is empty.");
      if (prompt.length > MAX_PROMPT_CHARS) throw new UserError("The task is too long.");
      if (agent.provider !== "webhook" && !agent.model) throw new UserError("Pick a model for this agent.");
      if (!agent.apiKey && !["custom", "webhook"].includes(agent.provider)) {
        throw new UserError("Add an API key for this agent.");
      }

      return json(await runAgent({ agent, system, prompt }));
    } catch (error) {
      return errorResponse(error);
    }
  },
};
