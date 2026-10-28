import { requireUser } from "./_lib/auth.js";
import { errorResponse, json, parseAgent, parseImages, readJson, UserError } from "./_lib/providers.js";
import { pollJob, startJob, type JobState } from "./_lib/jobs.js";

/**
 * POST /api/job — media generation and autonomous agents.
 *   { action: "start", agent, prompt, images? } → JobResult
 *   { action: "poll", agent, job }               → JobResult
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const denied = requireUser(request);
    if (denied) return denied;
    try {
      const body = await readJson(request);
      const agent = parseAgent(body.agent);
      if (!agent.apiKey && !["focus", "webhook"].includes(agent.provider)) throw new UserError("Add an API key for this agent's connection.");
      if (body.action === "poll") {
        const job = body.job as JobState | undefined;
        if (!job || typeof job.id !== "string") throw new UserError("Missing job.");
        return json(await pollJob(agent, job));
      }
      const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 100_000) : "";
      return json(await startJob(agent, prompt, parseImages(body.images)));
    } catch (error) {
      return errorResponse(error);
    }
  },
};
