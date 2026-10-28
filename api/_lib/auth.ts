import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Stateless sign-in: everything lives in HMAC-signed, HttpOnly cookies, so no
 * database is needed. Sign-in turns on as soon as AUTH_SECRET and at least one
 * way to sign in (GitHub, Google or email) are configured.
 */

export interface User {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  via: "github" | "google" | "email";
}

const SESSION = "focus_session";
const STATE = "focus_oauth";
const CODE = "focus_code";
const SESSION_DAYS = 30;
const CODE_MINUTES = 10;
const CODE_TRIES = 5;

const env = (k: string) => process.env[k]?.trim() || "";
const secret = () => env("AUTH_SECRET");

export function providers() {
  if (!secret()) return { github: false, google: false, email: false };
  return {
    github: !!(env("GITHUB_CLIENT_ID") && env("GITHUB_CLIENT_SECRET")),
    google: !!(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET")),
    email: !!(env("RESEND_API_KEY") && env("EMAIL_FROM")),
  };
}

export const authEnabled = () => Object.values(providers()).some(Boolean);

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString();
const mac = (s: string) => createHmac("sha256", secret()).update(s).digest("base64url");

function sign(data: object): string {
  const body = b64(JSON.stringify(data));
  return `${body}.${mac(body)}`;
}

function verify<T extends { exp: number }>(token: string | undefined): T | undefined {
  if (!token || !secret()) return;
  const [body, sig] = token.split(".");
  if (!body || !sig) return;
  const want = Buffer.from(mac(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return;
  try {
    const data = JSON.parse(unb64(body)) as T;
    return data.exp > Date.now() ? data : undefined;
  } catch {
    return;
  }
}

function cookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(request: Request, name: string, value: string, maxAgeSec: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

export function currentUser(request: Request): User | undefined {
  return verify<User & { exp: number }>(cookies(request)[SESSION]);
}

/** Throws a 401 response when sign-in is on and the request has no session. */
export function requireUser(request: Request): Response | undefined {
  if (!authEnabled() || currentUser(request)) return;
  return new Response(JSON.stringify({ error: "Sign in to use Focus." }), { status: 401, headers: { "content-type": "application/json" } });
}

const origin = (request: Request) => new URL(request.url).origin;
const redirect = (to: string, ...setCookies: string[]) => {
  const headers = new Headers({ location: to });
  for (const c of setCookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
};
const json = (data: unknown, status = 200, ...setCookies: string[]) => {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const c of setCookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify(data), { status, headers });
};

function startSession(request: Request, user: User): Response {
  const token = sign({ ...user, exp: Date.now() + SESSION_DAYS * 864e5 });
  return redirect("/app", cookie(request, SESSION, token, SESSION_DAYS * 86400), cookie(request, STATE, "", 0));
}

/* ---------- OAuth ---------- */

const OAUTH = {
  github: {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    id: "GITHUB_CLIENT_ID",
    secret: "GITHUB_CLIENT_SECRET",
  },
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    id: "GOOGLE_CLIENT_ID",
    secret: "GOOGLE_CLIENT_SECRET",
  },
} as const;

const callbackUrl = (request: Request, p: keyof typeof OAUTH) => `${origin(request)}/api/auth?a=${p}-callback`;

function oauthStart(request: Request, p: keyof typeof OAUTH): Response {
  const o = OAUTH[p];
  const state = b64(crypto.getRandomValues(new Uint8Array(18)).join("."));
  const url = new URL(o.authorize);
  url.searchParams.set("client_id", env(o.id));
  url.searchParams.set("redirect_uri", callbackUrl(request, p));
  url.searchParams.set("scope", o.scope);
  url.searchParams.set("state", state);
  if (p === "google") {
    url.searchParams.set("response_type", "code");
    url.searchParams.set("prompt", "select_account");
  }
  return redirect(url.toString(), cookie(request, STATE, sign({ state, exp: Date.now() + 600_000 }), 600));
}

async function oauthCallback(request: Request, p: keyof typeof OAUTH): Promise<Response> {
  const url = new URL(request.url);
  const saved = verify<{ state: string; exp: number }>(cookies(request)[STATE]);
  const code = url.searchParams.get("code");
  if (!code || !saved || saved.state !== url.searchParams.get("state")) return redirect("/app?auth=failed");
  const o = OAUTH[p];
  const tokenRes = await fetch(o.token, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env(o.id), client_secret: env(o.secret), code, redirect_uri: callbackUrl(request, p), grant_type: "authorization_code" }),
  });
  const token = ((await tokenRes.json().catch(() => ({}))) as { access_token?: string }).access_token;
  if (!token) return redirect("/app?auth=failed");
  const auth = { authorization: `Bearer ${token}`, accept: "application/json", "user-agent": "Focus" };

  if (p === "github") {
    const u = (await (await fetch("https://api.github.com/user", { headers: auth })).json()) as { id: number; login: string; name?: string; avatar_url?: string; email?: string };
    let email = u.email;
    if (!email) {
      const list = (await (await fetch("https://api.github.com/user/emails", { headers: auth })).json().catch(() => [])) as { email: string; primary: boolean; verified: boolean }[];
      email = Array.isArray(list) ? list.find((e) => e.primary && e.verified)?.email : undefined;
    }
    return startSession(request, { id: `gh:${u.id}`, name: u.name || u.login, email, avatar: u.avatar_url, via: "github" });
  }
  const u = (await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: auth })).json()) as { sub: string; name?: string; email?: string; email_verified?: boolean; picture?: string };
  if (!u.sub) return redirect("/app?auth=failed");
  return startSession(request, { id: `google:${u.sub}`, name: u.name || u.email || "Google user", email: u.email_verified ? u.email : undefined, avatar: u.picture, via: "google" });
}

/* ---------- email codes ---------- */

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,}$/i;
const codeHash = (email: string, code: string) => createHash("sha256").update(`${secret()}|${email}|${code}`).digest("base64url");

async function sendCode(request: Request, email: string): Promise<Response> {
  email = email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: "That doesn't look like an email address." }, 400);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env("RESEND_API_KEY")}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env("EMAIL_FROM"),
      to: [email],
      subject: `${code} is your Focus code`,
      text: `Your Focus sign-in code is ${code}\n\nIt works for ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email.`,
      html: `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:420px;margin:auto;padding:32px;color:#1d1d1d"><h2 style="margin:0 0 8px">Your Focus code</h2><p style="color:#6e6e73;margin:0 0 24px">Enter it on the sign-in page. It works for ${CODE_MINUTES} minutes.</p><div style="font-size:34px;font-weight:700;letter-spacing:8px;padding:18px;background:#f2f2f1;border-radius:14px;text-align:center">${code}</div><p style="color:#a1a1a6;font-size:13px;margin-top:24px">If you didn't ask for this code, you can ignore this email.</p></div>`,
    }),
  });
  if (!res.ok) return json({ error: "Couldn't send the email. Try again in a minute." }, 502);
  const pending = sign({ email, hash: codeHash(email, code), tries: 0, exp: Date.now() + CODE_MINUTES * 60_000 });
  return json({ sent: true }, 200, cookie(request, CODE, pending, CODE_MINUTES * 60));
}

function checkCode(request: Request, code: string): Response {
  const pending = verify<{ email: string; hash: string; tries: number; exp: number }>(cookies(request)[CODE]);
  if (!pending) return json({ error: "The code expired. Ask for a new one." }, 400);
  if (pending.tries >= CODE_TRIES) return json({ error: "Too many wrong codes. Ask for a new one." }, 429, cookie(request, CODE, "", 0));
  const want = Buffer.from(pending.hash);
  const got = Buffer.from(codeHash(pending.email, code.replace(/\D/g, "")));
  if (want.length !== got.length || !timingSafeEqual(want, got)) {
    const next = sign({ ...pending, tries: pending.tries + 1 });
    return json({ error: `Wrong code. ${CODE_TRIES - pending.tries - 1} tries left.` }, 400, cookie(request, CODE, next, Math.max(1, Math.round((pending.exp - Date.now()) / 1000))));
  }
  const user: User = { id: `email:${pending.email}`, name: pending.email.split("@")[0], email: pending.email, via: "email" };
  const token = sign({ ...user, exp: Date.now() + SESSION_DAYS * 864e5 });
  return json({ user }, 200, cookie(request, SESSION, token, SESSION_DAYS * 86400), cookie(request, CODE, "", 0));
}

/* ---------- router ---------- */

export async function handleAuth(request: Request): Promise<Response> {
  const a = new URL(request.url).searchParams.get("a") ?? "me";
  const on = providers();
  if (a === "me") return json({ enabled: authEnabled(), providers: on, user: currentUser(request) ?? null });
  if (a === "logout") return json({ ok: true }, 200, cookie(request, SESSION, "", 0));
  if ((a === "github" || a === "github-callback") && !on.github) return json({ error: "GitHub sign-in isn't set up." }, 404);
  if ((a === "google" || a === "google-callback") && !on.google) return json({ error: "Google sign-in isn't set up." }, 404);
  if (a === "github" || a === "google") return oauthStart(request, a);
  if (a === "github-callback" || a === "google-callback") return oauthCallback(request, a === "github-callback" ? "github" : "google");
  if (a === "email-send" || a === "email-verify") {
    if (!on.email) return json({ error: "Email sign-in isn't set up." }, 404);
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    const body = (await request.json().catch(() => ({}))) as { email?: string; code?: string };
    return a === "email-send" ? sendCode(request, String(body.email ?? "")) : checkCode(request, String(body.code ?? ""));
  }
  return json({ error: "Unknown action." }, 404);
}
