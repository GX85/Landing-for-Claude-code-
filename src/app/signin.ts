import "../signin.css";
import { h } from "./dom";

export interface AuthUser {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  via: string;
}

interface AuthInfo {
  pool?: number;
  enabled: boolean;
  providers: { github: boolean; google: boolean; email: boolean };
  user: AuthUser | null;
  access?: { required: boolean; granted: boolean };
}

let info: AuthInfo | undefined;

/** Asks the server who is signed in. When sign-in isn't set up (or the server can't be reached), the app stays open. */
export async function authInfo(): Promise<AuthInfo> {
  if (info) return info;
  try {
    // an Artifact has no server of its own, so there is nothing to ask
    if (import.meta.env.VITE_ARTIFACT === "1") throw new Error("artifact");
    const res = await fetch("/api/auth?a=me", { cache: "no-store" });
    info = res.ok ? ((await res.json()) as AuthInfo) : undefined;
  } catch {
    // offline or no server: nothing to gate
  }
  return (info ??= { enabled: false, providers: { github: false, google: false, email: false }, user: null });
}

export const signedInUser = () => info?.user ?? null;

export async function signOut(): Promise<void> {
  await fetch("/api/auth?a=logout", { method: "POST" }).catch(() => undefined);
  location.href = "/";
}

const GITHUB = `<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;
const GOOGLE = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

const svg = (markup: string) => {
  const span = h("span", { class: "signin-ico" });
  span.innerHTML = markup;
  return span;
};

async function post(action: string, body: object): Promise<{ error?: string }> {
  const res = await fetch(`/api/auth?a=${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return res.ok ? data : { error: data.error || "Something went wrong. Try again." };
}

/** The sign-in card shown instead of the app until the user signs in. */
export function renderSignIn(el: HTMLElement, a: AuthInfo, onDone: () => void): void {
  const note = h("p", { class: "signin-note", role: "status" });
  if (new URLSearchParams(location.search).get("auth") === "failed") note.textContent = "Sign-in didn't finish. Try again.";

  const emailInput = h("input", { type: "email", placeholder: "you@example.com", autocomplete: "email", required: true, "aria-label": "Email" });
  const codeInput = h("input", { inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, placeholder: "6-digit code", "aria-label": "Code from the email", pattern: "[0-9]{6}" });
  const emailBtn = h("button", { class: "signin-btn primary", type: "submit" }, "Email me a code");
  let sentTo = "";

  const form = h("form", { class: "signin-form" }, emailInput, emailBtn);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    emailBtn.disabled = true;
    note.textContent = "";
    if (!sentTo) {
      const r = await post("email-send", { email: emailInput.value });
      emailBtn.disabled = false;
      if (r.error) return void (note.textContent = r.error);
      sentTo = emailInput.value.trim();
      note.textContent = `We sent a code to ${sentTo}. It works for 10 minutes.`;
      form.replaceChildren(codeInput, emailBtn, h("button", { class: "signin-link", type: "button", onclick: () => location.reload() }, "Use a different email"));
      emailBtn.textContent = "Sign in";
      codeInput.focus();
    } else {
      const r = await post("email-verify", { code: codeInput.value });
      emailBtn.disabled = false;
      if (r.error) return void (note.textContent = r.error);
      info = undefined;
      history.replaceState(null, "", "/app");
      onDone();
    }
  });

  el.replaceChildren(
    h(
      "div",
      { class: "signin" },
      h(
        "div",
        { class: "signin-card" },
        h("a", { class: "signin-logo", href: "/" }, "Focus"),
        h("h1", {}, "Sign in"),
        h("p", { class: "signin-lede" }, "Your team of models is one step away."),
        a.providers.github ? h("a", { class: "signin-btn", href: "/api/auth?a=github" }, svg(GITHUB), "Continue with GitHub") : null,
        a.providers.google ? h("a", { class: "signin-btn", href: "/api/auth?a=google" }, svg(GOOGLE), "Continue with Google") : null,
        a.providers.email && (a.providers.github || a.providers.google) ? h("div", { class: "signin-or" }, "or") : null,
        a.providers.email ? form : null,
        note,
      ),
    ),
  );
  (a.providers.email ? emailInput : el.querySelector<HTMLElement>(".signin-btn"))?.focus();
}

/** The closed door: the app needs an access key. The key is checked on the server and never ships in the page. */
export function renderGate(el: HTMLElement, onDone: () => void): void {
  const note = h("p", { class: "signin-note", role: "status" });
  const input = h("input", { type: "password", inputmode: "numeric", autocomplete: "off", placeholder: "Access key", "aria-label": "Access key", required: true });
  const btn = h("button", { class: "signin-btn primary", type: "submit" }, "Enter Focus");
  const form = h("form", { class: "signin-form" }, input, btn);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    btn.disabled = true;
    note.textContent = "";
    const r = await post("key", { key: input.value });
    btn.disabled = false;
    if (r.error) {
      note.textContent = r.error;
      input.value = "";
      input.focus();
      return;
    }
    info = undefined;
    onDone();
  });
  el.replaceChildren(
    h(
      "div",
      { class: "signin" },
      h(
        "div",
        { class: "signin-card" },
        h("a", { class: "signin-logo", href: "/" }, "Focus"),
        h("h1", {}, "Access key"),
        h("p", { class: "signin-lede" }, "Focus opens with a key. Write to ", h("a", { href: "mailto:ItsTeamSwift@proton.me?subject=Focus%20access" }, "ItsTeamSwift@proton.me"), " to get the right to use the best free AI model."),
        form,
        note,
        h("a", { class: "signin-btn", href: "/" }, "← Back to the landing"),
      ),
    ),
  );
  input.focus();
}
