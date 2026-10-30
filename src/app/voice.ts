import { getLang } from "../i18n";

/**
 * Voice input for browsers whose speech recognition is missing or broken (many Android browsers):
 * records with the microphone, turns the recording into 16 kHz mono WAV and lets the server transcribe it.
 */

const MAX_MS = 60_000;
const RATE = 16_000;

export interface Recording {
  /** Stops recording and resolves with the transcript. */
  finish: () => Promise<string>;
  /** Stops and throws the recording away. */
  cancel: () => void;
}

export const canRecord = () => typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** Starts recording; `onAutoStop` fires when the minute runs out. */
export async function startRecording(onAutoStop: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported?.(t));
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((ok) => (rec.onstop = () => ok()));
  rec.start(250);
  const timer = setTimeout(onAutoStop, MAX_MS);
  const release = () => {
    clearTimeout(timer);
    for (const t of stream.getTracks()) t.stop();
  };
  const stop = async () => {
    if (rec.state !== "inactive") rec.stop();
    await stopped;
    release();
  };
  return {
    cancel: () => void stop(),
    finish: async () => {
      await stop();
      const blob = new Blob(chunks, { type: rec.mimeType || type || "audio/webm" });
      if (blob.size < 1200) return "";
      const wav = await toWav(blob);
      const res = await fetch("/api/transcribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audio: await toBase64(wav), lang: getLang() }) });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error || `Voice input failed (${res.status}).`);
      return data.text ?? "";
    },
  };
}

/** Any recording the browser can decode → 16 kHz mono 16-bit WAV (small, and every speech model reads it). */
async function toWav(blob: Blob): Promise<Blob> {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    void ctx.close();
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * RATE));
  const offline = new OfflineAudioContext(1, frames, RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const pcm = (await offline.startRendering()).getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const text = (at: number, s: string) => [...s].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  out.setUint32(4, 36 + pcm.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, RATE, true);
  out.setUint32(28, RATE * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  text(36, "data");
  out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([out.buffer], { type: "audio/wav" });
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).slice(String(r.result).indexOf(",") + 1));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });
}
