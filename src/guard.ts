/**
 * Deterrents for the published site: no right-click menu, and the usual shortcuts for the source view and the
 * developer tools do nothing. A browser always has to be given the page's code to run it, so this raises the bar
 * rather than sealing it; everything that must stay secret (keys, the access key) lives on the server only.
 */
if (import.meta.env.PROD && import.meta.env.VITE_ARTIFACT !== "1") {
  const editable = (t: EventTarget | null) => t instanceof Element && !!t.closest("input, textarea, [contenteditable], .md, pre, code");
  addEventListener("contextmenu", (e) => {
    if (!editable(e.target)) e.preventDefault();
  });
  addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "F12" || (mod && e.shiftKey && (k === "i" || k === "j" || k === "c")) || (mod && (k === "u" || k === "s")) || (e.metaKey && e.altKey && (k === "i" || k === "u"))) e.preventDefault();
  });
}
export {};
