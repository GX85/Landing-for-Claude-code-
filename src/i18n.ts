/**
 * Two languages: English (the source text) and Russian. Russian is applied to the page as it is built:
 * every piece of interface text is looked up in a dictionary, and anything added later is translated as it appears.
 * Chat messages (yours and the AI's) are never touched.
 */
export type Lang = "en" | "ru";

const KEY = "focus.lang";
const stored = (): Lang | undefined => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "ru" || v === "en" ? v : undefined;
  } catch {
    return undefined;
  }
};

let lang: Lang = stored() ?? (typeof navigator !== "undefined" && /^ru\b/i.test(navigator.language) ? "ru" : "en");
let translate: ((s: string) => string) | undefined;

export const getLang = (): Lang => lang;

/** Translates one line of interface text (a no-op in English). */
export const tr = (s: string): string => (translate ? translate(s) : s);

export function setLang(next: Lang): void {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // private mode: the choice lasts until the next reload only
  }
  lang = next;
  location.reload();
}

const ATTRS = ["placeholder", "title", "aria-label", "alt"];
const SKIP = "script, style, textarea, input, pre, code, .md, .bubble, .msg.user, .stream-code, [data-no-i18n], [contenteditable]";

function fixText(node: Text): void {
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP)) return;
  const raw = node.nodeValue ?? "";
  const lead = raw.match(/^\s*/)?.[0] ?? "";
  const tail = raw.match(/\s*$/)?.[0] ?? "";
  const body = raw.trim();
  if (!body) return;
  const out = tr(body);
  if (out !== body) node.nodeValue = lead + out + tail;
}

function fixAttrs(el: Element): void {
  if (el.closest(SKIP.replace("input, ", "").replace("textarea, ", ""))) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const out = tr(v);
    if (out !== v) el.setAttribute(a, out);
  }
}

function fixTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) return fixText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (el.closest(".md, .bubble, .msg.user, pre, [data-no-i18n]")) return;
  fixAttrs(el);
  for (const child of el.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(","))) fixAttrs(child);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) fixText(n as Text);
}

/** Sets the page language and, for Russian, translates the page and keeps translating what is added. */
export async function initI18n(): Promise<void> {
  document.documentElement.lang = lang;
  if (lang !== "ru") return;
  translate = (await import("./i18n-ru")).translateRu;
  const run = () => {
    fixTree(document.documentElement);
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "childList") r.addedNodes.forEach((n) => fixTree(n));
        else if (r.type === "characterData") fixText(r.target as Text);
        else if (r.type === "attributes") fixAttrs(r.target as Element);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.body) run();
  else addEventListener("DOMContentLoaded", run, { once: true });
}

/** A small button that shows the current language and switches to the other one. */
export function langButton(cls = "icon-btn"): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `${cls} lang-btn`;
  b.textContent = lang === "ru" ? "RU" : "EN";
  b.setAttribute("data-no-i18n", "");
  b.title = lang === "ru" ? "Switch to English" : "Переключить на русский";
  b.setAttribute("aria-label", b.title);
  b.addEventListener("click", () => setLang(lang === "ru" ? "en" : "ru"));
  return b;
}
