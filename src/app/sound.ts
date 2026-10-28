/** Mechanical keyboard clicks, synthesised with Web Audio (no files to load). */

let ctx: AudioContext | undefined;
let enabled = true;
let last = 0;

export const setSound = (on: boolean) => (enabled = on);

function audio(): AudioContext | undefined {
  if (!enabled || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** One key: a short noise "tick" for the switch plus a low "thock" for the keycap. */
export function click(volume = 1): void {
  const ac = audio();
  if (!ac || ac.state !== "running") return;
  const t = ac.currentTime;
  const gain = 0.14 * volume * (0.75 + Math.random() * 0.5);

  const len = Math.floor(ac.sampleRate * 0.03);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
  const noise = ac.createBufferSource();
  noise.buffer = buf;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 2600 + Math.random() * 1600;
  band.Q.value = 1.4;
  const ng = ac.createGain();
  ng.gain.value = gain;
  noise.connect(band).connect(ng).connect(ac.destination);
  noise.start(t);

  const osc = ac.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(190 + Math.random() * 60, t);
  osc.frequency.exponentialRampToValueAtTime(70, t + 0.05);
  const og = ac.createGain();
  og.gain.setValueAtTime(gain * 0.9, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  osc.connect(og).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.07);
}

/** For streamed answers: clicks at a typist's pace, however fast the text arrives. */
export function typingTick(): void {
  const now = performance.now();
  if (now - last < 55 + Math.random() * 45) return;
  last = now;
  click(0.6);
}
