import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { requireUser } from "./_lib/auth.js";
import { errorResponse, json, readJson, UserError } from "./_lib/providers.js";

/**
 * POST /api/web — the AI's way onto the internet.
 *   {"action":"search","query":"…"}  → {"results":[{"title","url","snippet"}]}
 *   {"action":"fetch","url":"…"}     → {"url","title","text"}   (a page as plain text)
 * Searching uses the owner's Tavily or Brave key when there is one, else Bing's open RSS feed, else Wikipedia.
 * Fetching refuses anything that isn't a public web address, so it can't be turned on the server's own network.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 FocusBot/1.0";
const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&nbsp;/g, " ");
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

interface Hit {
  title: string;
  url: string;
  snippet: string;
}

async function tavily(query: string, key: string): Promise<Hit[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: 6, include_answer: false }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`tavily ${res.status}`);
  const d = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
  return (d.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content.slice(0, 300) }));
}

async function brave(query: string, key: string): Promise<Hit[]> {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6`, {
    headers: { "x-subscription-token": key, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`brave ${res.status}`);
  const d = (await res.json()) as { web?: { results?: { title: string; url: string; description: string }[] } };
  return (d.web?.results ?? []).map((r) => ({ title: strip(r.title), url: r.url, snippet: strip(r.description ?? "").slice(0, 300) }));
}

async function bing(query: string): Promise<Hit[]> {
  const res = await fetch(`https://www.bing.com/search?format=rss&count=8&q=${encodeURIComponent(query)}`, { headers: { "user-agent": UA, accept: "application/rss+xml,text/xml" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`bing ${res.status}`);
  const xml = await res.text();
  const hits: Hit[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = m[1];
    const title = /<title>([\s\S]*?)<\/title>/.exec(item)?.[1];
    const url = /<link>([\s\S]*?)<\/link>/.exec(item)?.[1];
    const snippet = /<description>([\s\S]*?)<\/description>/.exec(item)?.[1] ?? "";
    if (title && url) hits.push({ title: strip(title), url: strip(url), snippet: strip(snippet).slice(0, 300) });
  }
  return hits;
}

async function wikipedia(query: string): Promise<Hit[]> {
  const lang = /[а-яё]/i.test(query) ? "ru" : "en";
  const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=6`, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`wikipedia ${res.status}`);
  const d = (await res.json()) as { query?: { search?: { title: string; snippet: string }[] } };
  return (d.query?.search ?? []).map((r) => ({ title: r.title, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`, snippet: strip(r.snippet) }));
}

async function search(query: string): Promise<Hit[]> {
  const tav = process.env.FOCUS_TAVILY_KEY?.trim();
  const bra = process.env.FOCUS_BRAVE_KEY?.trim();
  const tries: (() => Promise<Hit[]>)[] = [...(tav ? [() => tavily(query, tav)] : []), ...(bra ? [() => brave(query, bra)] : []), () => bing(query), () => wikipedia(query)];
  // with no search key, Bing's open feed is thin and often off-topic, so Wikipedia's results join it
  const keyed = !!(tav || bra);
  const merged: Hit[] = [];
  for (const t of tries) {
    try {
      const hits = await t();
      if (hits.length) {
        merged.push(...hits);
        if (keyed) break;
      }
      if (!keyed && merged.length >= 8) break;
    } catch {
      // try the next source
    }
  }
  const seen = new Set<string>();
  return merged.filter((h) => !seen.has(h.url) && seen.add(h.url)).slice(0, 8);
}

/* ---------- fetching a page, safely ---------- */

function privateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    return v === "::1" || v === "::" || v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.") || v.startsWith("::ffff:169.254.");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UserError("Only http and https addresses can be opened.");
  if (url.username || url.password) throw new UserError("Addresses with a login can't be opened.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new UserError("That address is not public.");
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!ips.length || ips.some(privateIp)) throw new UserError("That address is not public.");
}

function readable(html: string): { title: string; text: string } {
  const title = strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  let body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  body = body
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(h[1-6])[^>]*>/gi, "\n\n# ")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)>|<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ");
  const text = decode(body.replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

async function fetchPage(raw: string): Promise<{ url: string; title: string; text: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UserError("That isn't a web address.");
  }
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const res = await fetch(url, { redirect: "manual", headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5", "accept-language": "en,ru;q=0.8" }, signal: AbortSignal.timeout(15_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new UserError(`The page answered ${res.status}.`);
    const type = res.headers.get("content-type") ?? "";
    if (!/(text\/|json|xml)/i.test(type)) throw new UserError(`Can't read this kind of file (${type.split(";")[0] || "unknown"}).`);
    const reader = res.body?.getReader();
    let html = "";
    let size = 0;
    const decoder = new TextDecoder();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      html += decoder.decode(value, { stream: true });
      if (size > 1_500_000) {
        await reader.cancel();
        break;
      }
    }
    const page = /html/i.test(type) ? readable(html) : { title: "", text: html };
    return { url: url.toString(), title: page.title, text: page.text.slice(0, 14_000) };
  }
  throw new UserError("Too many redirects.");
}

export default {
  async fetch(request: Request): Promise<Response> {
    const denied = requireUser(request);
    if (denied) return denied;
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);
    try {
      const body = await readJson(request);
      if (body.action === "search") {
        const query = String(body.query ?? "").trim().slice(0, 300);
        if (!query) throw new UserError("What should I search for?");
        return json({ results: await search(query) });
      }
      if (body.action === "fetch") return json(await fetchPage(String(body.url ?? "")));
      throw new UserError("Unknown action.");
    } catch (error) {
      return errorResponse(error);
    }
  },
};
