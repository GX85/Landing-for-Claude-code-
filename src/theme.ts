/** Light and dark themes, shared by the landing and the app. Dark is the default. */

export type Theme = "light" | "dark";
const KEY = "focus.theme";

export const theme = (): Theme => (document.documentElement.classList.contains("light") ? "light" : "dark");

export function setTheme(next: Theme): void {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  root.classList.toggle("light", next === "light");
  root.classList.toggle("dark", next === "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#08080a" : "#f2f2f1");
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // private mode: the choice lasts for this visit
  }
  for (const b of document.querySelectorAll<HTMLElement>("[data-theme-toggle]")) b.setAttribute("aria-pressed", String(next === "dark"));
  setTimeout(() => root.classList.remove("theme-switching"), 400);
}

const SUN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle class="t-sun" cx="12" cy="12" r="4"/><path class="t-sun" d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/><path class="t-moon" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>`;

/** A sun/moon button that flips the theme. */
export function themeButton(className = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `theme-toggle ${className}`.trim();
  b.dataset.themeToggle = "";
  b.title = "Light or dark";
  b.setAttribute("aria-label", "Dark theme");
  b.setAttribute("aria-pressed", String(theme() === "dark"));
  b.innerHTML = SUN;
  b.addEventListener("click", () => setTheme(theme() === "dark" ? "light" : "dark"));
  return b;
}
