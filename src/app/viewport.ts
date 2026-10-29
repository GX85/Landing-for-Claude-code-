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

  // ?debug=1 prints what the browser reports, to chase keyboard problems on a real phone
  if (/[?&]debug\b/.test(location.search)) {
    const box = document.createElement("pre");
    box.style.cssText = "position:fixed;left:0;top:0;z-index:9999;margin:0;padding:4px 6px;font:11px/1.3 monospace;background:#000c;color:#0f0;pointer-events:none";
    document.body.append(box);
    const show = () => {
      const r = el.getBoundingClientRect();
      box.textContent = `inner ${innerWidth}x${innerHeight}  vv ${Math.round(vv.width)}x${Math.round(vv.height)} top ${Math.round(vv.offsetTop)} scale ${vv.scale.toFixed(2)}\napp top ${Math.round(r.top)} h ${Math.round(r.height)}  scrollY ${Math.round(scrollY)}  screen ${screen.width}x${screen.height}`;
    };
    for (const t of ["resize", "scroll"]) vv.addEventListener(t, show);
    setInterval(show, 500);
    show();
  }
}
