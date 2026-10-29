import { tr } from "../i18n";

/**
 * Text that is written by hand when something changes: the old line fades out, the new one is typed
 * letter by letter behind a blinking caret, like in Canva. A newer change always cancels an older one.
 */
const runs = new WeakMap<HTMLElement, { target: string; id: number }>();
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pace = (ch: string) => (ch === " " ? 18 : /[.,—·]/.test(ch) ? 90 : 20 + Math.random() * 22);

function claim(el: HTMLElement, text: string): number | undefined {
  const prev = runs.get(el);
  if (prev?.target === text) return;
  const id = (prev?.id ?? 0) + 1;
  runs.set(el, { target: text, id });
  return id;
}

/** Replaces an element's text with a fade-out, then typing. */
export async function typeInto(el: HTMLElement, text: string): Promise<void> {
  text = tr(text);
  const id = claim(el, text);
  if (id === undefined) return;
  const live = () => runs.get(el)?.id === id;
  if (still() || !el.textContent) {
    // first paint, or reduced motion: no fade, and no typing when nothing was there to replace
    if (still()) return void (el.textContent = text);
  } else {
    el.classList.add("tw-out");
    await wait(170);
    if (!live()) return;
  }
  el.classList.remove("tw-out");
  el.classList.add("tw-typing");
  el.textContent = "";
  for (let i = 1; i <= text.length; i++) {
    el.textContent = text.slice(0, i);
    await wait(pace(text[i - 1]));
    if (!live()) return;
  }
  await wait(1100);
  if (live()) el.classList.remove("tw-typing");
}

/** The same for a placeholder: the old one is erased backwards, the new one typed forwards. */
export async function typePlaceholder(input: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> {
  text = tr(text);
  const id = claim(input, text);
  if (id === undefined) return;
  const live = () => runs.get(input)?.id === id;
  if (still() || !input.placeholder) return void (input.placeholder = text);
  for (let n = input.placeholder.length - 1; n >= 0; n--) {
    input.placeholder = input.placeholder.slice(0, n);
    await wait(9);
    if (!live()) return;
  }
  for (let i = 1; i <= text.length; i++) {
    input.placeholder = text.slice(0, i);
    await wait(pace(text[i - 1]) * 0.8);
    if (!live()) return;
  }
}

/**
 * Types a paragraph out where it stands. The words not yet typed stay in the page, invisible, so nothing
 * around the paragraph moves while it is being written. When it is done the markup goes back to plain text.
 */
export async function typeReveal(el: HTMLElement, delay = 0): Promise<void> {
  const text = tr(el.textContent ?? "");
  if (el.dataset.typed || !text.trim() || still()) return;
  el.dataset.typed = "1";
  const done = document.createElement("span");
  const rest = document.createElement("span");
  done.className = "tw-t";
  rest.className = "tw-g";
  rest.textContent = text;
  el.replaceChildren(done, rest);
  if (delay) await wait(delay);
  const step = Math.min(22, Math.max(6, 1800 / text.length));
  el.classList.add("tw-typing");
  for (let i = 1; i <= text.length; i++) {
    if (!el.isConnected) return;
    done.textContent = text.slice(0, i);
    rest.textContent = text.slice(i);
    await wait(/[.,—·:]/.test(text[i - 1]) ? step * 5 : step);
  }
  el.classList.remove("tw-typing");
  el.textContent = text;
}

/** Hides each paragraph's words now and types them out the first time they scroll into view. */
export function typeOnView(els: HTMLElement[], delay = 0): void {
  if (still() || typeof IntersectionObserver === "undefined") return;
  const pending = els.filter((el) => !el.dataset.typed && el.textContent?.trim());
  for (const el of pending) el.classList.add("tw-wait");
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        (e.target as HTMLElement).classList.remove("tw-wait");
        void typeReveal(e.target as HTMLElement, delay);
      }
    },
    { threshold: 0.6 },
  );
  pending.forEach((el) => io.observe(el));
}
