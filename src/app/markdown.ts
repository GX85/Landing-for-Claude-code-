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
  // wide tables scroll sideways inside their own box instead of squeezing words apart
  for (const table of el.querySelectorAll("table")) {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    table.replaceWith(wrap);
    wrap.append(table);
  }
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
    const wrap = document.createElement("div");
    wrap.className = "code-block";
    head.append(label);
    const source = code?.textContent ?? "";
    // a whole HTML page (a game, a site, a slide deck) can be run right here, in a sandbox with no access to Focus
    if (lang === "html" && /<(html|body|script|canvas|div)\b/i.test(source)) {
      const run = document.createElement("button");
      run.type = "button";
      run.className = "code-preview-btn";
      run.textContent = "▶ Preview";
      let frame: HTMLIFrameElement | undefined;
      const open = (full: boolean) => {
        frame?.remove();
        document.querySelector(".preview-close")?.remove();
        frame = document.createElement("iframe");
        frame.className = `code-preview${full ? " full" : ""}`;
        frame.title = "Preview";
        frame.setAttribute("sandbox", "allow-scripts allow-modals allow-pointer-lock");
        frame.srcdoc = source;
        wrap.append(frame);
        if (full) {
          const close = document.createElement("button");
          close.type = "button";
          close.className = "preview-close";
          close.textContent = "Close preview";
          close.addEventListener("click", () => {
            close.remove();
            frame?.classList.remove("full");
          });
          document.body.append(close);
        }
        run.textContent = "■ Hide";
      };
      run.addEventListener("click", () => {
        if (frame?.isConnected) {
          frame.remove();
          document.querySelector(".preview-close")?.remove();
          run.textContent = "▶ Preview";
        } else open(false);
      });
      const full = document.createElement("button");
      full.type = "button";
      full.className = "code-preview-btn";
      full.textContent = "Full screen";
      full.addEventListener("click", () => open(true));
      head.append(run, full);
    }
    head.append(copy);
    pre.replaceWith(wrap);
    wrap.append(head, pre);
  }
}
