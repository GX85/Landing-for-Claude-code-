/**
 * Keeps the app exactly as big as what the person can see. When the on-screen keyboard opens, phones
 * shrink or pan the visual viewport; following it keeps the header on screen and the composer on top of the keyboard.
 */
let tracking = false;

export function trackViewport(el: HTMLElement): void {
  const vv = window.visualViewport;
  if (tracking || !vv) return;
  tracking = true;
  let frame = 0;
  const sync = () => {
    frame = 0;
    el.style.setProperty("--vvt", `${Math.max(0, vv.offsetTop)}px`);
    el.style.setProperty("--vvh", `${vv.height}px`);
  };
  const queue = () => {
    if (!frame) frame = requestAnimationFrame(sync);
  };
  vv.addEventListener("resize", queue);
  vv.addEventListener("scroll", queue);
  // focusing a field makes the browser scroll the page; the app is fixed, so put it back
  document.addEventListener("focusin", () => {
    queue();
    setTimeout(() => window.scrollTo(0, 0), 60);
    setTimeout(queue, 300);
  });
  sync();
}
