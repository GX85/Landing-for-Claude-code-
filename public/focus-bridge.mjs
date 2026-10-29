#!/usr/bin/env node
/**
 * Focus device bridge: lets Focus look through a folder on this computer or phone and, if you allow it, run commands.
 * Nothing leaves your machine except what Focus asks for and you've allowed.
 *
 *   node focus-bridge.mjs                  # read-only, your home folder
 *   node focus-bridge.mjs --root ~/Documents
 *   node focus-bridge.mjs --shell          # also let Focus run commands (you approve each one in Focus)
 *
 * Needs Node.js 18+. On Android install Termux, then: pkg install nodejs
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { exec } from "node:child_process";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

const PORT = Number(opt("--port", "7788"));
const ROOT = fs.realpathSync(path.resolve((opt("--root", os.homedir()) || os.homedir()).replace(/^~(?=$|\/)/, os.homedir())));
const SHELL = flag("--shell");
const ORIGINS = ["https://focus-agents.vercel.app", ...(process.env.FOCUS_ORIGIN ? process.env.FOCUS_ORIGIN.split(",") : [])];

// the token is kept between runs so Focus doesn't need to be re-paired every time
const TOKEN_FILE = path.join(os.homedir(), ".focus-bridge-token");
let TOKEN = "";
try {
  TOKEN = fs.readFileSync(TOKEN_FILE, "utf8").trim();
} catch {
  // first run
}
if (TOKEN.length < 20) {
  TOKEN = crypto.randomBytes(18).toString("base64url");
  try {
    fs.writeFileSync(TOKEN_FILE, TOKEN, { mode: 0o600 });
  } catch {
    // read-only home: the token lasts for this run
  }
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".cache", "Library", "AppData", "$RECYCLE.BIN", "proc", "sys"]);
const TEXT_LIMIT = 60_000;

const inside = (p) => {
  const real = fs.realpathSync(p);
  return real === ROOT || real.startsWith(ROOT + path.sep) ? real : null;
};
const resolveIn = (p = ".") => {
  // "/" or "/Documents" mean the folder Focus may use, not the whole disk
  let want = String(p).replace(/^~(?=$|\/)/, ROOT);
  if (path.isAbsolute(want) && !(want === ROOT || want.startsWith(ROOT + path.sep))) want = want.replace(/^[/\\]+/, "");
  const abs = path.resolve(ROOT, want);
  let real;
  try {
    real = inside(abs);
  } catch {
    throw new Error(`Not found: ${p}`);
  }
  if (!real) throw new Error("That path is outside the folder Focus may use.");
  if (path.basename(real) === SECRET) throw new Error("That file is private.");
  return real;
};

const SECRET = path.basename(TOKEN_FILE);
const isText = (buf) => !buf.subarray(0, 4000).includes(0);

const tools = {
  device_info() {
    return JSON.stringify({ system: `${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`, host: os.hostname(), user: os.userInfo().username, folderFocusMayUse: ROOT, commands: SHELL ? "allowed (each one needs your approval)" : "off", node: process.version }, null, 2);
  },
  fs_list({ path: p }) {
    const dir = resolveIn(p);
    const items = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.name !== SECRET).slice(0, 300).map((d) => {
      let size = "";
      try {
        if (d.isFile()) size = ` ${fs.statSync(path.join(dir, d.name)).size} B`;
      } catch {
        // unreadable entry
      }
      return `${d.isDirectory() ? "[dir] " : ""}${d.name}${size}`;
    });
    return `${path.relative(ROOT, dir) || "."}\n${items.join("\n")}`;
  },
  fs_read({ path: p }) {
    const file = resolveIn(p);
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error("That is not a file.");
    const buf = fs.readFileSync(file);
    if (!isText(buf)) throw new Error("That file isn't text.");
    const text = buf.toString("utf8");
    return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n… (${text.length - TEXT_LIMIT} more characters)` : text;
  },
  fs_search({ query, path: p }) {
    const q = String(query ?? "").toLowerCase().trim();
    if (!q) throw new Error("What should I look for?");
    // words are matched by their stem, so "пятницу" finds "пятница" and "folders" finds "folder"
    const terms = q.split(/\s+/).filter(Boolean).map((t) => (t.length > 5 ? t.slice(0, -2) : t));
    const has = (text) => terms.every((t) => text.includes(t));
    const start = resolveIn(p);
    const hits = [];
    let seen = 0;
    const walk = (dir, depth) => {
      if (depth > 8 || hits.length >= 30 || seen > 30000) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of entries) {
        if (hits.length >= 30 || ++seen > 30000) return;
        const full = path.join(dir, d.name);
        if (d.isDirectory()) {
          if (!SKIP_DIRS.has(d.name) && !d.isSymbolicLink()) walk(full, depth + 1);
          continue;
        }
        if (!d.isFile() || d.name === SECRET) continue;
        if (has(d.name.toLowerCase())) {
          hits.push(`${path.relative(ROOT, full)}  (name match)`);
          continue;
        }
        try {
          const stat = fs.statSync(full);
          if (stat.size > 1_000_000) continue;
          const buf = fs.readFileSync(full);
          if (!isText(buf)) continue;
          const text = buf.toString("utf8");
          const low = text.toLowerCase();
          const at = has(low) ? low.indexOf(terms[0]) : -1;
          if (at >= 0) hits.push(`${path.relative(ROOT, full)}: …${text.slice(Math.max(0, at - 60), at + 100).replace(/\s+/g, " ")}…`);
        } catch {
          // unreadable file
        }
      }
    };
    walk(start, 0);
    return hits.length ? hits.join("\n") : "Nothing found.";
  },
  shell({ command }) {
    if (!SHELL) throw new Error("Commands are off. Start the bridge with --shell to allow them.");
    return new Promise((resolve) => {
      exec(String(command ?? ""), { cwd: ROOT, timeout: 30_000, maxBuffer: 1_000_000 }, (err, stdout, stderr) => {
        const out = `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`.trim();
        resolve(`${err ? `exit ${err.code ?? "error"}\n` : ""}${out.slice(0, 20_000) || "(no output)"}`);
      });
    });
  },
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

http
  .createServer(async (req, res) => {
    const origin = req.headers.origin ?? "";
    const allowed = ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = allowed ? { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type, x-focus-token", "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-private-network": "true", vary: "origin" } : {};
    if (req.method === "OPTIONS") return send(res, allowed ? 204 : 403, {}, cors);
    if (!allowed && origin) return send(res, 403, { error: "This page isn't allowed to use the bridge." });
    const given = Buffer.from(String(req.headers["x-focus-token"] ?? ""));
    const want = Buffer.from(TOKEN);
    const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
    if (req.url === "/ping") return send(res, ok ? 200 : 401, ok ? { ok: true, root: ROOT, shell: SHELL } : { error: "Wrong token." }, cors);
    if (req.url !== "/tool" || req.method !== "POST") return send(res, 404, { error: "Not found." }, cors);
    if (!ok) return send(res, 401, { error: "Wrong token." }, cors);
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 100_000) return send(res, 413, { error: "Too large." }, cors);
    }
    try {
      const { tool, args: a } = JSON.parse(raw || "{}");
      if (!Object.hasOwn(tools, tool)) return send(res, 400, { error: `Unknown tool: ${tool}` }, cors);
      send(res, 200, { result: String(await tools[tool](a ?? {})) }, cors);
    } catch (error) {
      send(res, 400, { error: error instanceof Error ? error.message : String(error) }, cors);
    }
  })
  .listen(PORT, "127.0.0.1", () => {
    console.log(`\nFocus device bridge is running.\n\n  Address:  http://127.0.0.1:${PORT}\n  Key:      ${TOKEN}\n  Folder:   ${ROOT}\n  Commands: ${SHELL ? "ON (you approve each one in Focus)" : "off"}\n\nPaste the address and key into Focus → Settings → Device. Press Ctrl+C to stop.\n`);
  });
