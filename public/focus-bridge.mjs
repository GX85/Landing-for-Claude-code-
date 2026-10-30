#!/usr/bin/env node
/**
 * Focus device bridge: lets Focus look through a folder on this computer or phone and, if you allow it, run commands.
 * Nothing leaves your machine except what Focus asks for and you've allowed.
 *
 *   node focus-bridge.mjs                  # read-only, your home folder
 *   node focus-bridge.mjs --root ~/Documents
 *   node focus-bridge.mjs --shell          # also let Focus run commands (you approve each one in Focus)
 *   node focus-bridge.mjs --no-control     # turn off device control (open apps and links, clipboard, typing,
 *                                          # notifications, screenshots); each action is approved in Focus anyway
 *
 * Needs Node.js 18+. On Android install Termux, then: pkg install nodejs
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { exec, execFile } from "node:child_process";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

const PORT = Number(opt("--port", "7788"));
const ROOT = fs.realpathSync(path.resolve((opt("--root", os.homedir()) || os.homedir()).replace(/^~(?=$|\/)/, os.homedir())));
const SHELL = flag("--shell");
const CONTROL = !flag("--no-control");
const OS = process.platform;
const TERMUX = !!process.env.TERMUX_VERSION || fs.existsSync("/data/data/com.termux");
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
    return JSON.stringify({ system: `${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`, host: os.hostname(), user: os.userInfo().username, folderFocusMayUse: ROOT, commands: SHELL ? "allowed (each one needs your approval)" : "off", control: CONTROL ? "on: open, clipboard, notifications, typing, screenshots (each action needs your approval)" : "off", android: TERMUX, node: process.version }, null, 2);
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

/* ---------- device control: every action is approved by the user in Focus first ---------- */

/** Runs a program with arguments (never through a shell, so nothing in the text can turn into a command). */
const run = (file, argv, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(file, argv, { timeout: 20_000, maxBuffer: 4_000_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim().slice(0, 400) || `${file} failed`));
      else resolve(String(stdout));
    });
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });

/** The first program in the list that runs. */
const first = async (attempts) => {
  let last;
  for (const [file, argv, input] of attempts) {
    try {
      return await run(file, argv, input);
    } catch (error) {
      last = error;
    }
  }
  throw new Error(`Not available on this device${last ? ` (${last.message})` : ""}.`);
};

const needControl = () => {
  if (!CONTROL) throw new Error("Device control is off (the bridge was started with --no-control).");
};

const ps = (script) => ["powershell", ["-NoProfile", "-NonInteractive", "-Command", script]];

const control = {
  async open({ target }) {
    needControl();
    let t = String(target ?? "").trim();
    if (!t) throw new Error("What should I open?");
    // a link opens in the browser; anything else is an app name or a file in the folder Focus may use
    if (!/^(https?|mailto|tel):/i.test(t)) {
      try {
        t = resolveIn(t);
      } catch {
        // not a file: treat it as an app name
        if (OS === "darwin") return (await run("open", ["-a", t]), `Opened the app ${t}.`);
        if (OS === "win32") return (await run("cmd", ["/c", "start", "", t]), `Opened ${t}.`);
        if (TERMUX) throw new Error("On Android, ask for a link or a file instead of an app name.");
        return (await first([[t, []], ["gtk-launch", [t]]]), `Opened ${t}.`);
      }
    }
    if (TERMUX) await first([["termux-open-url", [t]], ["termux-open", [t]]]);
    else if (OS === "darwin") await run("open", [t]);
    else if (OS === "win32") await run("cmd", ["/c", "start", "", t]);
    else await first([["xdg-open", [t]], ["gio", ["open", t]]]);
    return `Opened ${t}.`;
  },
  async clipboard_read() {
    needControl();
    const text = TERMUX
      ? await run("termux-clipboard-get", [])
      : OS === "darwin"
        ? await run("pbpaste", [])
        : OS === "win32"
          ? await run(...ps("Get-Clipboard -Raw"))
          : await first([["wl-paste", ["-n"]], ["xclip", ["-selection", "clipboard", "-o"]], ["xsel", ["-b", "-o"]]]);
    return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n…` : text || "(the clipboard is empty)";
  },
  async clipboard_write({ text }) {
    needControl();
    const t = String(text ?? "");
    if (TERMUX) await run("termux-clipboard-set", [], t);
    else if (OS === "darwin") await run("pbcopy", [], t);
    else if (OS === "win32") await run(...ps("$input | Set-Clipboard"), t);
    else await first([["wl-copy", [], t], ["xclip", ["-selection", "clipboard"], t], ["xsel", ["-b", "-i"], t]]);
    return `Copied ${t.length} characters to the clipboard.`;
  },
  async notify({ title, text }) {
    needControl();
    const a = String(title ?? "Focus").slice(0, 80);
    const b = String(text ?? "").slice(0, 300);
    if (TERMUX) await run("termux-notification", ["--title", a, "--content", b]);
    else if (OS === "darwin") await run("osascript", ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", a, b]);
    else if (OS === "win32") await run(...ps("$l = @($input); Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(5000, $l[0], ($l | Select-Object -Skip 1) -join ' ', 'Info'); Start-Sleep 6; $n.Dispose()"), `${a.replace(/\n/g, " ")}\n${b}`);
    else await run("notify-send", [a, b]);
    return "Notification shown.";
  },
  async type_text({ text }) {
    needControl();
    const t = String(text ?? "").slice(0, 2000);
    if (!t) throw new Error("What should I type?");
    if (TERMUX) throw new Error("Typing into other apps isn't possible on Android.");
    if (OS === "darwin") await run("osascript", ["-e", "on run argv", "-e", 'tell application "System Events" to keystroke (item 1 of argv)', "-e", "end run", t]);
    else if (OS === "win32") await run(...ps("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(($input | Out-String).TrimEnd() -replace '([+^%~(){}\\[\\]])','{$1}')"), t);
    else await first([["wtype", [t]], ["xdotool", ["type", "--delay", "8", "--", t]]]);
    return `Typed ${t.length} characters into the active window.`;
  },
  async screenshot() {
    needControl();
    const dir = path.join(ROOT, "Focus screenshots");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `screen-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
    if (TERMUX) throw new Error("Android doesn't let programs take screenshots of other apps.");
    if (OS === "darwin") await run("screencapture", ["-x", file]);
    else if (OS === "win32")
      await run(...ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b = [System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height; $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size); $bmp.Save('${file.replace(/'/g, "''")}')`));
    else await first([["grim", [file]], ["gnome-screenshot", ["-f", file]], ["spectacle", ["-b", "-n", "-o", file]], ["import", ["-window", "root", file]], ["scrot", [file]]]);
    return `Saved a screenshot to ${path.relative(ROOT, file)}.`;
  },
};
Object.assign(tools, control);

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
    if (req.url === "/ping") return send(res, ok ? 200 : 401, ok ? { ok: true, root: ROOT, shell: SHELL, control: CONTROL } : { error: "Wrong token." }, cors);
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
    console.log(`\nFocus device bridge is running.\n\n  Address:  http://127.0.0.1:${PORT}\n  Key:      ${TOKEN}\n  Folder:   ${ROOT}\n  Commands: ${SHELL ? "ON (you approve each one in Focus)" : "off"}\n  Control:  ${CONTROL ? "ON (open, clipboard, notifications, typing, screenshots; you approve each one)" : "off"}\n\nPaste the address and key into Focus → Settings → Device. Press Ctrl+C to stop.\n`);
  });
