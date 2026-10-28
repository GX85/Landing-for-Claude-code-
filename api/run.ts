import { describeError, errorResponse, parseAgent, parseMessages, readJson, runAgent, UserError } from "./_lib/providers.js";

/**
 * POST /api/run — one call to one agent, streamed back as NDJSON:
 *   {"type":"delta","text":"…"}   pieces of the answer as they arrive
 *   {"type":"done","text":"…",…}  the complete answer
 *   {"type":"error","error":"…"}  the call failed; discard any partial text
 * The browser sends the agent's settings (including the user's own API key) with
 * each request; nothing is stored or logged here.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    let input;
    try {
      const body = await readJson(request);
      const agent = parseAgent(body.agent);
      const messages = parseMessages(body);
      const system = typeof body.system === "string" ? body.system.slice(0, 20_000) : undefined;
      if (agent.provider !== "webhook" && !agent.model) throw new UserError("Pick a model for this agent.");
      if (!agent.apiKey && !["custom", "webhook", "focus"].includes(agent.provider)) {
        throw new UserError("Add an API key for this agent's connection.");
      }
      input = { agent, messages, system };
    } catch (error) {
      return errorResponse(error);
    }

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: object) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            // the browser went away
          }
        };
        try {
          const result = await runAgent({ ...input, signal: request.signal, onText: (text) => send({ type: "delta", text }) });
          send({ type: "done", ...result });
        } catch (error) {
          send({ type: "error", error: describeError(error).message });
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      },
    });

    return new Response(body, {
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
    });
  },
};
