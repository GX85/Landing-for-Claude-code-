import { requireUser } from "./_lib/auth.js";
import { errorResponse, json, readJson, UserError } from "./_lib/providers.js";

/**
 * POST /api/transcribe — voice input for browsers without built-in speech recognition.
 *   {"audio":"<base64 WAV, 16 kHz mono>","lang":"ru"|"en"} → {"text":"…"}
 * Tries the owner's Groq Whisper or Gemini key when there is one, then free audio models on OpenRouter.
 */

const MAX_BASE64 = 3_400_000; // about 75 seconds of 16 kHz mono WAV
const OPENROUTER_AUDIO = ["nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "thinkingmachines/inkling-small:free", "thinkingmachines/inkling:free"];

const instruction = (lang: string) =>
  `Transcribe this voice message word for word${lang === "ru" ? " (it is most likely in Russian)" : ""}. Reply with the transcript only: no quotes, no notes, no translation. If nothing is said, reply with an empty line.`;

const clean = (text: string) =>
  text
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, "")
    .replace(/^\s*(transcript(ion)?|расшифровка)\s*:\s*/i, "")
    .replace(/^["«“]+|["»”]+$/g, "")
    .trim();

async function groq(audio: Buffer, lang: string, key: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "voice.wav");
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", lang);
  form.append("response_format", "json");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`groq ${res.status}`);
  return ((await res.json()) as { text?: string }).text ?? "";
}

async function gemini(base64: string, lang: string, key: string): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts: [{ text: instruction(lang) }, { inline_data: { mime_type: "audio/wav", data: base64 } }] }] }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

async function openrouter(base64: string, lang: string, key: string, model: string): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "HTTP-Referer": "https://focus-agents.vercel.app", "X-Title": "Focus" },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      messages: [{ role: "user", content: [{ type: "text", text: instruction(lang) }, { type: "input_audio", input_audio: { data: base64, format: "wav" } }] }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`openrouter ${model} ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

export default {
  async fetch(request: Request): Promise<Response> {
    const denied = requireUser(request);
    if (denied) return denied;
    try {
      const body = (await readJson(request)) as { audio?: unknown; lang?: unknown };
      const base64 = typeof body.audio === "string" ? body.audio.replace(/^data:[^,]*,/, "") : "";
      if (!base64) throw new UserError("No audio was sent.");
      if (base64.length > MAX_BASE64) throw new UserError("The recording is too long. Keep it under a minute.");
      const lang = body.lang === "ru" ? "ru" : "en";
      const tries: (() => Promise<string>)[] = [];
      const groqKey = process.env.FOCUS_GROQ_KEY?.trim();
      const geminiKey = process.env.FOCUS_GEMINI_KEY?.trim();
      const orKey = process.env.FOCUS_OPENROUTER_KEY?.trim();
      if (groqKey) tries.push(() => groq(Buffer.from(base64, "base64"), lang, groqKey));
      if (geminiKey) tries.push(() => gemini(base64, lang, geminiKey));
      if (orKey) for (const m of OPENROUTER_AUDIO) tries.push(() => openrouter(base64, lang, orKey, m));
      if (!tries.length) throw new UserError("Voice input needs a speech key on the server (FOCUS_GROQ_KEY, FOCUS_GEMINI_KEY or FOCUS_OPENROUTER_KEY).", 503);
      let last: unknown;
      for (const run of tries) {
        try {
          const text = clean(await run());
          if (text) return json({ text });
          last = new Error("empty transcript");
        } catch (error) {
          last = error;
        }
      }
      throw new UserError(`Couldn't recognise the speech right now${last instanceof Error ? ` (${last.message})` : ""}. Try again.`, 502);
    } catch (error) {
      return errorResponse(error);
    }
  },
};
