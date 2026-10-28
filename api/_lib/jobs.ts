import { GenerateVideosOperation, GoogleGenAI } from "@google/genai";
import { openAIClient, UserError, type AgentConfig, type ImagePart } from "./providers.js";

/**
 * Media generators and autonomous agents run as jobs: `start` kicks one off and
 * `poll` checks on it, so nothing has to fit in one serverless call. The job state
 * travels to the browser and back; nothing is kept here.
 */
export interface JobState {
  id: string;
  /** Provider-specific extras needed to poll, e.g. a status URL. */
  extra?: Record<string, string>;
}

export interface JobResult {
  status: "running" | "done" | "error";
  job?: JobState;
  text?: string;
  /** An https URL, a data: URL, or `proxy:<provider>:<url>` for files that need the key (fetched through /api/media). */
  media?: string;
  progress?: string;
  error?: string;
}

const TIMEOUT = 120_000;
const timeout = () => AbortSignal.timeout(TIMEOUT);

async function http<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers as Record<string, string>) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    signal: rest.signal ?? timeout(),
  });
  const raw = await res.text();
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    // not JSON
  }
  if (!res.ok) {
    const d = data as { error?: { message?: string } | string; message?: string; detail?: string };
    const message = typeof d === "string" ? d : (typeof d.error === "string" ? d.error : d.error?.message) ?? d.message ?? d.detail ?? raw;
    const hint = res.status === 401 || res.status === 403 ? "The API key was rejected. " : res.status === 402 ? "Out of credits. " : res.status === 429 ? "Rate limited — try again shortly. " : "";
    throw new UserError(`${hint}${String(message).slice(0, 300)}`, res.status === 401 || res.status === 403 || res.status === 429 ? res.status : 502);
  }
  return data as T;
}

const dataUrl = (mediaType: string, base64: string) => `data:${mediaType};base64,${base64}`;
const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

/* ---------- start ---------- */

export async function startJob(agent: AgentConfig, prompt: string, images: ImagePart[]): Promise<JobResult> {
  const text = prompt.trim();
  if (!text && !images.length) throw new UserError("The prompt is empty.");

  switch (agent.provider) {
    case "focus": {
      if (agent.kind !== "image") break;
      // free, keyless image generation
      const seed = Math.floor(Math.random() * 1e9);
      const model = agent.model ? `&model=${encodeURIComponent(agent.model)}` : "";
      return { status: "done", media: `https://image.pollinations.ai/prompt/${encodeURIComponent(text.slice(0, 1500))}?width=1024&height=1024&nologo=true&seed=${seed}${model}`, text: "Free image from Focus." };
    }

    case "pollinations": {
      if (agent.kind === "video") return startExternal(agent, text, images);
      if (agent.kind !== "image") break;
      const params = new URLSearchParams({ model: agent.model || "zimage" });
      if (images[0]) params.set("image", dataUrl(images[0].mediaType, images[0].data));
      const res = await fetch(`${POLLINATIONS}/image/${encodeURIComponent(text.slice(0, 1500))}?${params}`, {
        headers: agent.apiKey ? bearer(agent.apiKey) : {},
        signal: AbortSignal.timeout(280_000),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new UserError(`Pollinations answered ${res.status}: ${body.slice(0, 240)}`, res.status === 401 ? 401 : 502);
      }
      const type = res.headers.get("content-type") ?? "image/jpeg";
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > 4_000_000) throw new UserError("The image is larger than Focus can pass through (4 MB).", 502);
      return { status: "done", media: dataUrl(type.split(";")[0], bytes.toString("base64")) };
    }

    case "openai": {
      if (agent.kind !== "image") break;
      const result = await openAIClient(agent).images.generate({ model: agent.model || "gpt-image-1", prompt: text });
      const img = result.data?.[0];
      const media = img?.b64_json ? dataUrl("image/png", img.b64_json) : img?.url;
      if (!media) throw new UserError("OpenAI returned no image.", 502);
      return { status: "done", media, text: img?.revised_prompt ?? undefined };
    }

    case "gemini": {
      const ai = new GoogleGenAI({ apiKey: agent.apiKey });
      if (agent.kind === "video") {
        const op = await ai.models.generateVideos({
          model: agent.model || "veo-3.1-fast-generate-preview",
          prompt: text,
          ...(images[0] ? { image: { imageBytes: images[0].data, mimeType: images[0].mediaType } } : {}),
        });
        if (!op.name) throw new UserError("Gemini didn't start the video.", 502);
        return { status: "running", job: { id: op.name }, progress: "Veo is rendering the video…" };
      }
      if (agent.kind === "image") {
        const model = agent.model || "imagen-4.0-generate-001";
        if (/imagen/i.test(model)) {
          const res = await ai.models.generateImages({ model, prompt: text, config: { numberOfImages: 1 } });
          const bytes = res.generatedImages?.[0]?.image?.imageBytes;
          if (!bytes) throw new UserError("Gemini returned no image (the prompt may have been filtered).", 422);
          return { status: "done", media: dataUrl(res.generatedImages?.[0]?.image?.mimeType ?? "image/png", bytes) };
        }
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [...images.map((i) => ({ inlineData: { mimeType: i.mediaType, data: i.data } })), { text }] }],
        });
        const parts = res.candidates?.[0]?.content?.parts ?? [];
        const img = parts.find((p) => p.inlineData?.data);
        if (!img?.inlineData?.data) throw new UserError("Gemini returned no image.", 422);
        return {
          status: "done",
          media: dataUrl(img.inlineData.mimeType ?? "image/png", img.inlineData.data),
          text: parts.flatMap((p) => (p.text ? [p.text] : [])).join("\n") || undefined,
        };
      }
      break;
    }

    default:
      return startExternal(agent, text, images);
  }
  throw new UserError(`This connection can't make ${agent.kind === "agent" ? "agent tasks" : `${agent.kind}s`}.`);
}

/* ---------- poll ---------- */

export async function pollJob(agent: AgentConfig, job: JobState): Promise<JobResult> {
  if (agent.provider === "gemini" && agent.kind === "video") {
    const ai = new GoogleGenAI({ apiKey: agent.apiKey });
    const op = await ai.operations.getVideosOperation({ operation: Object.assign(new GenerateVideosOperation(), { name: job.id }) });
    if (!op.done) return { status: "running", job, progress: "Veo is rendering the video…" };
    if (op.error) return { status: "error", error: String(op.error.message ?? "Veo failed.") };
    const video = op.response?.generatedVideos?.[0]?.video;
    if (video?.videoBytes) return { status: "done", media: dataUrl(video.mimeType ?? "video/mp4", video.videoBytes) };
    if (video?.uri) return { status: "done", media: `proxy:gemini:${video.uri}` };
    const filtered = op.response?.raiMediaFilteredReasons?.join(" ");
    return { status: "error", error: filtered ? `Veo filtered the video: ${filtered}` : "Veo returned no video." };
  }
  return pollExternal(agent, job);
}

/* ---------- external services (video generators and autonomous agents) ---------- */

const LUMA = "https://api.lumalabs.ai/dream-machine/v1";
const REPLICATE = "https://api.replicate.com/v1";
const MANUS = "https://api.manus.ai/v2";
const JULES = "https://jules.googleapis.com/v1alpha";
const DEVIN = "https://api.devin.ai/v3/organizations";
// a literal, not derived from providers.ts: the two modules import each other
const POLLINATIONS = "https://gen.pollinations.ai";

const firstUrl = (v: unknown): string | undefined =>
  typeof v === "string" ? (/^https?:\/\//.test(v) ? v : undefined) : Array.isArray(v) ? firstUrl(v[0]) : undefined;

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: string | null;
  logs?: string;
}

function replicateResult(p: ReplicatePrediction): JobResult {
  if (p.status === "succeeded") {
    const url = firstUrl(p.output);
    if (url) return { status: "done", media: `proxy:replicate:${url}` };
    const text = Array.isArray(p.output) ? p.output.join("") : typeof p.output === "string" ? p.output : JSON.stringify(p.output, null, 2);
    return { status: "done", text };
  }
  if (p.status === "failed" || p.status === "canceled") return { status: "error", error: p.error || `Replicate ${p.status}.` };
  const lastLog = p.logs?.trim().split("\n").at(-1);
  return { status: "running", job: { id: p.id }, progress: lastLog ? `Replicate: ${lastLog.slice(0, 120)}` : `Replicate is ${p.status}…` };
}

/** The repository and branch for a Jules agent, written as `sources/github/owner/repo@branch`. */
function julesSource(model: string): { source: string; branch: string } {
  const [source, branch] = model.split("@");
  if (!source?.startsWith("sources/")) throw new UserError('Set the agent\'s repository, e.g. "sources/github/owner/repo" (Load shows your connected repos).');
  return { source, branch: branch || "main" };
}

const devinId = (id: string) => (id.startsWith("devin-") ? id : `devin-${id}`);

async function startExternal(agent: AgentConfig, text: string, images: ImagePart[]): Promise<JobResult> {
  const key = agent.apiKey;
  switch (agent.provider) {
    case "luma": {
      const g = await http<{ id: string; state: string }>(`${LUMA}/generations/video`, {
        method: "POST",
        headers: bearer(key),
        json: { prompt: text, model: agent.model || "ray-2", aspect_ratio: "16:9" },
      });
      return { status: "running", job: { id: g.id }, progress: "Luma is dreaming…" };
    }
    case "replicate": {
      const [owner, name] = (agent.model || "").split("/");
      if (!owner || !name) throw new UserError('Set the Replicate model as "owner/name", e.g. "black-forest-labs/flux-schnell".');
      const input: Record<string, unknown> = { prompt: text };
      if (images[0]) input.image = dataUrl(images[0].mediaType, images[0].data);
      const p = await http<ReplicatePrediction>(`${REPLICATE}/models/${owner}/${name}/predictions`, {
        method: "POST",
        headers: { ...bearer(key), prefer: "wait=50" },
        json: { input },
      });
      return replicateResult(p);
    }
    case "pollinations": {
      // only video reaches here (images return directly above)
      const params = new URLSearchParams({ model: agent.model || "alibaba/wan-2.2-fast" });
      if (images[0]) params.set("image", dataUrl(images[0].mediaType, images[0].data));
      const res = await fetch(`${POLLINATIONS}/video/${encodeURIComponent(text.slice(0, 1500))}?${params}`, {
        headers: { ...bearer(key), prefer: "respond-async" },
        signal: timeout(),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
      if (!res.ok || !body.id) throw new UserError(`Pollinations answered ${res.status}: ${body.error?.message ?? "no job id"}`, res.status === 401 ? 401 : 502);
      return { status: "running", job: { id: body.id }, progress: "Rendering the video…" };
    }
    case "manus": {
      const t = await http<{ task_id: string; task_url?: string }>(`${MANUS}/task.create`, {
        method: "POST",
        headers: { "x-manus-api-key": key },
        json: { message: { content: text }, ...(agent.model ? { agent_profile: agent.model } : {}) },
      });
      return { status: "running", job: { id: t.task_id, extra: { url: t.task_url ?? "", nudges: "0" } }, progress: "Manus started the task…" };
    }
    case "jules": {
      const { source, branch } = julesSource(agent.model);
      const session = await http<{ id: string; name: string; url?: string }>(`${JULES}/sessions`, {
        method: "POST",
        headers: { "x-goog-api-key": key },
        json: { prompt: text, title: text.slice(0, 80), sourceContext: { source, githubRepoContext: { startingBranch: branch } }, automationMode: "AUTO_CREATE_PR" },
      });
      return { status: "running", job: { id: session.id }, progress: "Jules is planning…" };
    }
    case "devin": {
      const org = agent.baseUrl?.trim();
      if (!org) throw new UserError("Add your Devin organization ID (org-…) to the connection.");
      const s = await http<{ session_id: string; url: string }>(`${DEVIN}/${encodeURIComponent(org)}/sessions`, {
        method: "POST",
        headers: bearer(key),
        json: { prompt: text, title: text.slice(0, 80) },
      });
      return { status: "running", job: { id: s.session_id, extra: { url: s.url } }, progress: "Devin is starting…" };
    }
  }
  throw new UserError("This connection can't run tasks.");
}

async function pollExternal(agent: AgentConfig, job: JobState): Promise<JobResult> {
  const key = agent.apiKey;
  switch (agent.provider) {
    case "luma": {
      const g = await http<{ state: string; failure_reason?: string; assets?: { video?: string } }>(`${LUMA}/generations/${job.id}`, { headers: bearer(key) });
      if (g.state === "completed" && g.assets?.video) return { status: "done", media: g.assets.video };
      if (g.state === "failed") return { status: "error", error: g.failure_reason || "Luma couldn't make the video." };
      return { status: "running", job, progress: g.state === "queued" ? "Queued at Luma…" : "Luma is dreaming…" };
    }
    case "replicate":
      return replicateResult(await http<ReplicatePrediction>(`${REPLICATE}/predictions/${job.id}`, { headers: bearer(key) }));
    case "pollinations": {
      const j = await http<{ status: string; error?: { message?: string } | string }>(`${POLLINATIONS}/v1/jobs/${job.id}`, { headers: bearer(key) });
      if (j.status === "succeeded") return { status: "done", media: `proxy:pollinations:${POLLINATIONS}/v1/jobs/${job.id}/result` };
      if (j.status === "failed") return { status: "error", error: typeof j.error === "string" ? j.error : j.error?.message ?? "The video failed." };
      return { status: "running", job, progress: "Rendering the video…" };
    }
    case "manus": {
      const url = job.extra?.url;
      const d = await http<{ task: { status: string; has_running_background_jobs?: boolean; task_url?: string } }>(`${MANUS}/task.detail?task_id=${encodeURIComponent(job.id)}`, {
        headers: { "x-manus-api-key": key },
      });
      const link = d.task.task_url || url;
      const nudges = Number(job.extra?.nudges ?? 0);
      if (d.task.status === "error") return { status: "error", error: `Manus hit an error.${link ? ` Details: ${link}` : ""}` };
      if (d.task.status === "waiting") {
        if (nudges >= 3) return { status: "done", text: `Manus is waiting for your input. Continue the task here: ${link}` };
        // an autonomous run: let Manus decide for itself rather than stall
        await http(`${MANUS}/task.sendMessage`, { method: "POST", headers: { "x-manus-api-key": key }, json: { task_id: job.id, message: { content: "Continue and use your best judgment." } } });
        return { status: "running", job: { ...job, extra: { ...job.extra, nudges: String(nudges + 1) } }, progress: "Manus asked a question; told it to continue…" };
      }
      if (d.task.status === "stopped" && !d.task.has_running_background_jobs) {
        type Listing = { messages?: unknown[]; events?: unknown[]; data?: unknown[] };
        const m = await http<Listing>(`${MANUS}/task.listMessages?task_id=${encodeURIComponent(job.id)}&order=desc&limit=20`, {
          headers: { "x-manus-api-key": key },
        }).catch((): Listing => ({}));
        const events = (m.messages ?? m.events ?? m.data ?? []) as Record<string, unknown>[];
        const answer = events
          .map((e) => (e.assistant_message as { content?: unknown } | undefined)?.content ?? (e.type === "assistant_message" ? e.content : undefined))
          .find((c): c is string => typeof c === "string" && !!c.trim());
        return { status: "done", text: [answer ?? "Manus finished the task.", link ? `\n\n[Open the task in Manus](${link})` : ""].join("") };
      }
      return { status: "running", job, progress: "Manus is working…" };
    }
    case "jules": {
      const s = await http<{ state?: string; url?: string; outputs?: { pullRequest?: { url?: string; title?: string; description?: string } }[] }>(`${JULES}/sessions/${job.id}`, {
        headers: { "x-goog-api-key": key },
      });
      const pr = s.outputs?.find((o) => o.pullRequest?.url)?.pullRequest;
      if (s.state === "COMPLETED") {
        return { status: "done", text: pr ? `Jules opened a pull request: [${pr.title || pr.url}](${pr.url})\n\n${pr.description ?? ""}`.trim() : "Jules completed the session." };
      }
      if (s.state === "FAILED") return { status: "error", error: "Jules couldn't complete the task." };
      if (s.state === "AWAITING_PLAN_APPROVAL") {
        await http(`${JULES}/sessions/${job.id}:approvePlan`, { method: "POST", headers: { "x-goog-api-key": key }, json: {} });
        return { status: "running", job, progress: "Approved Jules' plan…" };
      }
      if (s.state === "AWAITING_USER_FEEDBACK") return { status: "done", text: `Jules needs your input to continue: https://jules.google.com/session/${job.id}` };
      const acts = await http<{ activities?: { progressUpdated?: { title?: string } }[] }>(`${JULES}/sessions/${job.id}/activities?pageSize=30`, {
        headers: { "x-goog-api-key": key },
      }).catch(() => ({}) as { activities?: { progressUpdated?: { title?: string } }[] });
      const last = acts.activities?.map((a) => a.progressUpdated?.title).filter(Boolean).at(-1);
      return { status: "running", job, progress: last ? `Jules: ${last}` : `Jules is ${String(s.state ?? "working").toLowerCase().replace(/_/g, " ")}…` };
    }
    case "devin": {
      const org = agent.baseUrl?.trim() ?? "";
      const s = await http<{ status: string; status_detail?: string; url?: string; structured_output?: unknown; pull_requests?: { pr_url: string }[] }>(
        `${DEVIN}/${encodeURIComponent(org)}/sessions/${devinId(job.id)}`,
        { headers: bearer(key) },
      );
      const link = s.url || job.extra?.url;
      const prs = (s.pull_requests ?? []).map((p) => `- ${p.pr_url}`).join("\n");
      const finished = s.status === "exit" || (s.status === "running" && s.status_detail === "finished");
      if (finished) {
        const out = s.structured_output ? `\n\n\`\`\`json\n${JSON.stringify(s.structured_output, null, 2)}\n\`\`\`` : "";
        return { status: "done", text: `Devin finished.${prs ? `\n\nPull requests:\n${prs}` : ""}${out}${link ? `\n\n[Open the session](${link})` : ""}` };
      }
      if (s.status === "error") return { status: "error", error: `Devin hit an error.${link ? ` ${link}` : ""}` };
      if (s.status === "suspended") return { status: "error", error: `Devin paused the session (${s.status_detail ?? "suspended"}).${link ? ` ${link}` : ""}` };
      if (s.status_detail === "waiting_for_user" || s.status_detail === "waiting_for_approval") {
        return { status: "done", text: `Devin is waiting for you: ${link}` };
      }
      return { status: "running", job, progress: `Devin is ${s.status_detail ?? s.status}…` };
    }
  }
  throw new UserError("Unknown job.");
}

/** Suggestions for the model field of media and agent connections. */
export async function listJobModels(agent: AgentConfig): Promise<string[]> {
  switch (agent.provider) {
    case "luma":
      return ["ray-2", "ray-flash-2"];
    case "replicate":
      return agent.kind === "image"
        ? ["black-forest-labs/flux-schnell", "black-forest-labs/flux-1.1-pro", "ideogram-ai/ideogram-v3-turbo"]
        : ["wan-video/wan-2.2-t2v-fast", "kwaivgi/kling-v2.1", "minimax/video-01", "google/veo-3-fast"];
    case "manus":
      return ["standard", "lite", "max"];
    case "jules": {
      const d = await http<{ sources?: { name: string }[] }>(`${JULES}/sources?pageSize=100`, { headers: { "x-goog-api-key": agent.apiKey } });
      return (d.sources ?? []).map((s) => s.name);
    }
    default:
      return [];
  }
}

/* ---------- media proxy ---------- */

const PROXY_HOSTS: Record<string, RegExp> = {
  gemini: /^generativelanguage\.googleapis\.com$/,
  replicate: /(^|\.)replicate\.delivery$|^api\.replicate\.com$/,
  pollinations: /^gen\.pollinations\.ai$/,
};

/** Fetches a generated file that needs the connection's key, for /api/media. */
export async function fetchMedia(agent: AgentConfig, url: string): Promise<Response> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new UserError("Bad media URL.");
  }
  const allowed = PROXY_HOSTS[agent.provider];
  if (u.protocol !== "https:" || !allowed?.test(u.hostname)) throw new UserError("This media URL can't be fetched through Focus.");
  const headers: Record<string, string> = agent.provider === "gemini" ? { "x-goog-api-key": agent.apiKey } : bearer(agent.apiKey);
  return fetch(u, { headers, redirect: "follow", signal: AbortSignal.timeout(120_000) });
}
