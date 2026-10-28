import { UserError, type AgentConfig, type ImagePart } from "./providers.js";
import type { JobResult, JobState } from "./jobs.js";

/**
 * More image and video generators. Most have a free tier or free starting
 * credits; each needs its own key from the provider.
 */

export const GENERATORS = [
  "together",
  "siliconflow",
  "nebius",
  "deepinfra",
  "huggingface",
  "cloudflare",
  "stability",
  "fal",
  "segmind",
  "deepai",
  "minimax",
  "runway",
  "ideogram",
  "bfl",
] as const;
export type Generator = (typeof GENERATORS)[number];

export const isGenerator = (p: string): p is Generator => (GENERATORS as readonly string[]).includes(p);

/** Default and suggested models per provider and kind. */
export const GENERATOR_MODELS: Record<Generator, { image?: string[]; video?: string[] }> = {
  together: { image: ["black-forest-labs/FLUX.1-schnell-Free", "black-forest-labs/FLUX.1-schnell", "black-forest-labs/FLUX.1-dev", "black-forest-labs/FLUX.1.1-pro"] },
  siliconflow: { image: ["Kwai-Kolors/Kolors", "black-forest-labs/FLUX.1-schnell", "Qwen/Qwen-Image"], video: ["Wan-AI/Wan2.2-T2V-A14B", "Wan-AI/Wan2.2-I2V-A14B"] },
  nebius: { image: ["black-forest-labs/flux-schnell", "black-forest-labs/flux-dev", "stability-ai/sdxl"] },
  deepinfra: { image: ["black-forest-labs/FLUX-1-schnell", "black-forest-labs/FLUX-1-dev", "stabilityai/sdxl-turbo"] },
  huggingface: { image: ["black-forest-labs/FLUX.1-schnell", "stabilityai/stable-diffusion-xl-base-1.0", "black-forest-labs/FLUX.1-dev"] },
  cloudflare: { image: ["@cf/black-forest-labs/flux-1-schnell", "@cf/bytedance/stable-diffusion-xl-lightning", "@cf/lykon/dreamshaper-8-lcm", "@cf/leonardo/phoenix-1.0"] },
  stability: { image: ["core", "ultra", "sd3.5-large-turbo", "sd3.5-large"] },
  fal: { image: ["fal-ai/flux/schnell", "fal-ai/flux/dev", "fal-ai/recraft-v3", "fal-ai/ideogram/v3"], video: ["fal-ai/ltx-video", "fal-ai/wan/v2.2-a14b/text-to-video", "fal-ai/kling-video/v2.1/standard/text-to-video", "fal-ai/minimax/hailuo-02/standard/text-to-video"] },
  segmind: { image: ["flux-schnell", "sdxl1.0-txt2img", "fast-flux-schnell"] },
  deepai: { image: ["text2img", "hd"] },
  minimax: { image: ["image-01"], video: ["MiniMax-Hailuo-02", "T2V-01-Director", "I2V-01"] },
  runway: { image: ["gen4_image"], video: ["gen4_turbo", "gen3a_turbo"] },
  ideogram: { image: ["V_3_TURBO", "V_3"] },
  bfl: { image: ["flux-pro-1.1", "flux-dev", "flux-kontext-pro"] },
};

const TIMEOUT = 120_000;
const dataUrl = (mediaType: string, base64: string) => `data:${mediaType};base64,${base64}`;
const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
const asImage = (image?: ImagePart) => (image ? dataUrl(image.mediaType, image.data) : undefined);

async function call(url: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers as Record<string, string>) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) {
    const raw = await res.text();
    let message = raw;
    try {
      const d = JSON.parse(raw);
      message = d.error?.message ?? d.error ?? d.message ?? d.detail ?? d.errors?.[0]?.message ?? d.base_resp?.status_msg ?? raw;
      if (typeof message !== "string") message = JSON.stringify(message);
    } catch {
      // not JSON
    }
    const hint = res.status === 401 || res.status === 403 ? "The API key was rejected. " : res.status === 402 ? "Out of credits. " : res.status === 429 ? "Rate limited — try again shortly. " : "";
    throw new UserError(`${hint}${message.slice(0, 300)}`, [401, 403, 429].includes(res.status) ? res.status : 502);
  }
  return res;
}

const getJson = async <T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> => (await call(url, init)).json() as Promise<T>;

/** Responses that are the image itself. */
async function imageBytes(res: Response): Promise<string> {
  const type = res.headers.get("content-type") ?? "image/png";
  if (type.includes("json")) {
    const d = (await res.json()) as { image?: string; result?: { image?: string }; artifacts?: { base64: string }[] };
    const b64 = d.image ?? d.result?.image ?? d.artifacts?.[0]?.base64;
    if (!b64) throw new UserError("The generator returned no image.");
    return dataUrl("image/png", b64);
  }
  return dataUrl(type.split(";")[0], Buffer.from(await res.arrayBuffer()).toString("base64"));
}

/** OpenAI-style /images/generations responses: data[0].url or data[0].b64_json (or SiliconFlow's images[0].url). */
function openAIImage(d: { data?: { url?: string; b64_json?: string }[]; images?: { url?: string }[] }): JobResult {
  const first = d.data?.[0];
  const media = first?.b64_json ? dataUrl("image/png", first.b64_json) : first?.url ?? d.images?.[0]?.url;
  if (!media) return { status: "error", error: "The generator returned no image." };
  return { status: "done", media };
}

const OPENAI_IMAGE_BASE: Partial<Record<Generator, string>> = {
  together: "https://api.together.xyz/v1",
  siliconflow: "https://api.siliconflow.com/v1",
  nebius: "https://api.studio.nebius.com/v1",
  deepinfra: "https://api.deepinfra.com/v1/openai",
};

const STABILITY_PATH: Record<string, string> = { core: "core", ultra: "ultra" };

export async function startGenerator(agent: AgentConfig, text: string, images: ImagePart[]): Promise<JobResult> {
  const p = agent.provider as Generator;
  const key = agent.apiKey;
  const kind = agent.kind === "video" ? "video" : "image";
  const model = agent.model || GENERATOR_MODELS[p][kind]?.[0] || "";
  if (!GENERATOR_MODELS[p][kind]) throw new UserError(`This connection can't make ${kind}s.`);

  switch (p) {
    case "together":
    case "nebius":
    case "deepinfra":
      return openAIImage(await getJson(`${OPENAI_IMAGE_BASE[p]}/images/generations`, { method: "POST", headers: bearer(key), json: { model, prompt: text, n: 1, ...(p === "together" ? { steps: model.includes("schnell") ? 4 : 28 } : {}), ...(p === "nebius" ? { response_format: "url" } : {}) } }));

    case "siliconflow": {
      if (kind === "image") return openAIImage(await getJson(`${OPENAI_IMAGE_BASE.siliconflow}/images/generations`, { method: "POST", headers: bearer(key), json: { model, prompt: text, ...(images[0] ? { image: asImage(images[0]) } : {}) } }));
      const r = await getJson<{ requestId: string }>(`${OPENAI_IMAGE_BASE.siliconflow}/video/submit`, { method: "POST", headers: bearer(key), json: { model, prompt: text, image_size: "1280x720", ...(images[0] ? { image: asImage(images[0]) } : {}) } });
      return { status: "running", job: { id: r.requestId }, progress: "SiliconFlow is rendering the video…" };
    }

    case "huggingface":
      return { status: "done", media: await imageBytes(await call(`https://router.huggingface.co/hf-inference/models/${model}`, { method: "POST", headers: { ...bearer(key), accept: "image/png" }, json: { inputs: text } })) };

    case "cloudflare": {
      const account = (agent.baseUrl ?? "").trim();
      if (!/^[a-f0-9]{32}$/i.test(account)) throw new UserError("Put your Cloudflare account ID (32 characters) in the Account ID field.");
      const res = await call(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, { method: "POST", headers: bearer(key), json: { prompt: text, ...(model.includes("flux") ? { steps: 4 } : {}) } });
      return { status: "done", media: await imageBytes(res) };
    }

    case "stability": {
      const form = new FormData();
      form.set("prompt", text);
      form.set("output_format", "png");
      const path = STABILITY_PATH[model] ?? "sd3";
      if (path === "sd3") form.set("model", model);
      const res = await call(`https://api.stability.ai/v2beta/stable-image/generate/${path}`, { method: "POST", headers: { ...bearer(key), accept: "image/*" }, body: form });
      return { status: "done", media: await imageBytes(res) };
    }

    case "fal": {
      const input: Record<string, unknown> = { prompt: text };
      if (images[0]) input.image_url = asImage(images[0]);
      const q = await getJson<{ request_id: string; status_url: string; response_url: string }>(`https://queue.fal.run/${model}`, { method: "POST", headers: { authorization: `Key ${key}` }, json: input });
      return { status: "running", job: { id: q.request_id, extra: { status: q.status_url, result: q.response_url } }, progress: kind === "video" ? "fal is rendering the video…" : "fal is drawing…" };
    }

    case "segmind":
      return { status: "done", media: await imageBytes(await call(`https://api.segmind.com/v1/${model}`, { method: "POST", headers: { "x-api-key": key }, json: { prompt: text, ...(model.includes("flux") ? { steps: 4 } : {}) } })) };

    case "deepai": {
      const form = new FormData();
      form.set("text", text);
      if (model === "hd") form.set("image_generator_version", "hd");
      const d = await getJson<{ output_url?: string }>("https://api.deepai.org/api/text2img", { method: "POST", headers: { "api-key": key }, body: form });
      return d.output_url ? { status: "done", media: d.output_url } : { status: "error", error: "DeepAI returned no image." };
    }

    case "minimax": {
      if (kind === "image") {
        const d = await getJson<{ data?: { image_urls?: string[] }; base_resp?: { status_msg?: string } }>("https://api.minimax.io/v1/image_generation", { method: "POST", headers: bearer(key), json: { model, prompt: text, aspect_ratio: "1:1", response_format: "url" } });
        const url = d.data?.image_urls?.[0];
        return url ? { status: "done", media: url } : { status: "error", error: d.base_resp?.status_msg || "MiniMax returned no image." };
      }
      const d = await getJson<{ task_id?: string; base_resp?: { status_msg?: string } }>("https://api.minimax.io/v1/video_generation", { method: "POST", headers: bearer(key), json: { model, prompt: text, ...(images[0] ? { first_frame_image: asImage(images[0]) } : {}) } });
      if (!d.task_id) throw new UserError(d.base_resp?.status_msg || "MiniMax didn't start the video.");
      return { status: "running", job: { id: d.task_id }, progress: "Hailuo is rendering the video…" };
    }

    case "runway": {
      const headers = { ...bearer(key), "x-runway-version": "2024-11-06" };
      const t =
        kind === "image"
          ? await getJson<{ id: string }>("https://api.dev.runwayml.com/v1/text_to_image", { method: "POST", headers, json: { model, promptText: text.slice(0, 1000), ratio: "1360:768" } })
          : await getJson<{ id: string }>("https://api.dev.runwayml.com/v1/image_to_video", {
              method: "POST",
              headers,
              json: { model, promptText: text.slice(0, 1000), ratio: "1280:720", duration: 5, ...(images[0] ? { promptImage: asImage(images[0]) } : {}) },
            });
      return { status: "running", job: { id: t.id }, progress: "Runway is rendering…" };
    }

    case "ideogram": {
      const form = new FormData();
      form.set("prompt", text);
      form.set("rendering_speed", model === "V_3" ? "DEFAULT" : "TURBO");
      const d = await getJson<{ data?: { url?: string }[] }>("https://api.ideogram.ai/v1/ideogram-v3/generate", { method: "POST", headers: { "api-key": key }, body: form });
      const url = d.data?.[0]?.url;
      return url ? { status: "done", media: url } : { status: "error", error: "Ideogram returned no image." };
    }

    case "bfl": {
      const t = await getJson<{ id: string; polling_url: string }>(`https://api.bfl.ai/v1/${model}`, { method: "POST", headers: { "x-key": key }, json: { prompt: text, ...(images[0] ? { input_image: images[0].data } : {}) } });
      return { status: "running", job: { id: t.id, extra: { url: t.polling_url } }, progress: "FLUX is drawing…" };
    }
  }
}

export async function pollGenerator(agent: AgentConfig, job: JobState): Promise<JobResult> {
  const key = agent.apiKey;
  switch (agent.provider as Generator) {
    case "siliconflow": {
      const s = await getJson<{ status: string; reason?: string; results?: { videos?: { url: string }[] } }>(`${OPENAI_IMAGE_BASE.siliconflow}/video/status`, { method: "POST", headers: bearer(key), json: { requestId: job.id } });
      if (s.status === "Succeed" && s.results?.videos?.[0]) return { status: "done", media: s.results.videos[0].url };
      if (s.status === "Failed") return { status: "error", error: s.reason || "The video failed." };
      return { status: "running", job, progress: s.status === "InQueue" ? "Queued at SiliconFlow…" : "Rendering the video…" };
    }
    case "fal": {
      const s = await getJson<{ status: string; queue_position?: number }>(job.extra!.status, { headers: { authorization: `Key ${key}` } });
      if (s.status === "COMPLETED") {
        const r = await getJson<{ images?: { url: string }[]; video?: { url: string }; image?: { url: string } }>(job.extra!.result, { headers: { authorization: `Key ${key}` } });
        const media = r.video?.url ?? r.images?.[0]?.url ?? r.image?.url;
        return media ? { status: "done", media } : { status: "error", error: "fal returned no file." };
      }
      return { status: "running", job, progress: s.status === "IN_QUEUE" ? `Queued at fal${s.queue_position ? ` (#${s.queue_position})` : ""}…` : "Rendering…" };
    }
    case "minimax": {
      const s = await getJson<{ status: string; file_id?: string }>(`https://api.minimax.io/v1/query/video_generation?task_id=${encodeURIComponent(job.id)}`, { headers: bearer(key) });
      if (s.status === "Success" && s.file_id) {
        const f = await getJson<{ file?: { download_url?: string } }>(`https://api.minimax.io/v1/files/retrieve?file_id=${encodeURIComponent(s.file_id)}`, { headers: bearer(key) });
        return f.file?.download_url ? { status: "done", media: f.file.download_url } : { status: "error", error: "MiniMax returned no file." };
      }
      if (s.status === "Fail") return { status: "error", error: "Hailuo couldn't make the video." };
      return { status: "running", job, progress: s.status === "Queueing" ? "Queued at MiniMax…" : "Hailuo is rendering the video…" };
    }
    case "runway": {
      const t = await getJson<{ status: string; output?: string[]; failure?: string; progress?: number }>(`https://api.dev.runwayml.com/v1/tasks/${job.id}`, { headers: { ...bearer(key), "x-runway-version": "2024-11-06" } });
      if (t.status === "SUCCEEDED" && t.output?.[0]) return { status: "done", media: t.output[0] };
      if (t.status === "FAILED" || t.status === "CANCELLED") return { status: "error", error: t.failure || "Runway couldn't finish." };
      return { status: "running", job, progress: t.progress ? `Runway ${Math.round(t.progress * 100)}%…` : "Runway is rendering…" };
    }
    case "bfl": {
      const r = await getJson<{ status: string; result?: { sample?: string } }>(job.extra!.url, { headers: { "x-key": key } });
      if (r.status === "Ready" && r.result?.sample) return { status: "done", media: r.result.sample };
      if (/error|failed|moderated/i.test(r.status)) return { status: "error", error: `FLUX: ${r.status}` };
      return { status: "running", job, progress: "FLUX is drawing…" };
    }
    default:
      throw new UserError("Unknown job.");
  }
}
