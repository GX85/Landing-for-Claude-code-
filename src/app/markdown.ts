import { Marked } from "marked";
import DOMPurify from "dompurify";

const marked = new Marked({ gfm: true, breaks: true });

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

/** Renders untrusted Markdown into `el`, sanitized, with copy buttons on code blocks. */
export function renderMarkdown(el: HTMLElement, source: string): void {
  const html = marked.parse(source, { async: false });
  el.innerHTML = DOMPurify.sanitize(html, { FORBID_TAGS: ["style", "form", "input", "button"], FORBID_ATTR: ["style"] });
  for (const pre of el.querySelectorAll("pre")) {
    const code = pre.querySelector("code");
    const lang = /language-([\w+-]+)/.exec(code?.className ?? "")?.[1] ?? "";
    const head = document.createElement("div");
    head.className = "code-head";
    const label = document.createElement("span");
    label.textContent = lang || "code";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "code-copy";
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code?.textContent ?? pre.textContent ?? "");
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Couldn't copy";
      }
      setTimeout(() => (copy.textContent = "Copy"), 1500);
    });
    head.append(label, copy);
    const wrap = document.createElement("div");
    wrap.className = "code-block";
    pre.replaceWith(wrap);
    wrap.append(head, pre);
  }
}
