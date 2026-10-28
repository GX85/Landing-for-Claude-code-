import { handleAuth } from "./_lib/auth.js";

/** /api/auth?a=me|logout|github|google|email-send|email-verify (+ OAuth callbacks). */
export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handleAuth(request);
    } catch {
      return new Response(JSON.stringify({ error: "Sign-in failed. Try again." }), { status: 500, headers: { "content-type": "application/json" } });
    }
  },
};
