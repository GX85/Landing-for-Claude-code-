import { errorResponse, json, listModels, parseAgent, readJson, UserError } from "./_lib/providers.js";

/** POST /api/models — lists the models the user's key can use. */
export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const agent = parseAgent((await readJson(request)).agent);
      if (!agent.apiKey && agent.provider !== "custom") throw new UserError("Add an API key first.");
      return json({ models: await listModels(agent) });
    } catch (error) {
      return errorResponse(error);
    }
  },
};
