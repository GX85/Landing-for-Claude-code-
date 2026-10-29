/** Shared pieces for Focus's ready-made pages: colour themes, escaping and safe config embedding. */

export interface Theme {
  dark: boolean;
  bg: string;
  bg2: string;
  fg: string;
  muted: string;
  a: string;
  b: string;
  card: string;
  line: string;
}

export const THEMES: Record<string, Theme> = {
  neon: { dark: true, bg: "#05060d", bg2: "#14103a", fg: "#f2f4ff", muted: "#9aa3d6", a: "#39ff88", b: "#00e0ff", card: "rgba(255,255,255,.06)", line: "rgba(255,255,255,.12)" },
  sunset: { dark: true, bg: "#16090f", bg2: "#3a1424", fg: "#fff3ec", muted: "#e6b3a3", a: "#ff7a59", b: "#ffcf6b", card: "rgba(255,255,255,.07)", line: "rgba(255,255,255,.13)" },
  ocean: { dark: true, bg: "#041322", bg2: "#0b2f4f", fg: "#ecf8ff", muted: "#97c2db", a: "#3fd0ff", b: "#7cf5d6", card: "rgba(255,255,255,.06)", line: "rgba(255,255,255,.12)" },
  forest: { dark: true, bg: "#07130d", bg2: "#123222", fg: "#eefaf2", muted: "#a4c8b2", a: "#78e08f", b: "#f6d365", card: "rgba(255,255,255,.06)", line: "rgba(255,255,255,.12)" },
  candy: { dark: true, bg: "#14081c", bg2: "#3b1255", fg: "#fff0fb", muted: "#d6a9d8", a: "#ff5fb7", b: "#8f7bff", card: "rgba(255,255,255,.07)", line: "rgba(255,255,255,.13)" },
  mono: { dark: true, bg: "#09090b", bg2: "#1c1c22", fg: "#fafafa", muted: "#a1a1aa", a: "#ffffff", b: "#a1a1aa", card: "rgba(255,255,255,.06)", line: "rgba(255,255,255,.12)" },
  paper: { dark: false, bg: "#f7f3ea", bg2: "#ffffff", fg: "#1c1a16", muted: "#6e675a", a: "#d9480f", b: "#0f766e", card: "#ffffff", line: "rgba(0,0,0,.09)" },
  sky: { dark: false, bg: "#eef4ff", bg2: "#ffffff", fg: "#0f1b33", muted: "#5a6a88", a: "#2563eb", b: "#7c3aed", card: "#ffffff", line: "rgba(15,27,51,.1)" },
};

export const themeNames = Object.keys(THEMES);

export const pickTheme = (name: unknown): Theme => THEMES[String(name ?? "")] ?? THEMES.neon;

export const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Embeds data in a <script> safely: nothing in it can close the tag. */
export const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028|\u2029/g, " ");

export const cssVars = (t: Theme) =>
  `--bg:${t.bg};--bg2:${t.bg2};--fg:${t.fg};--muted:${t.muted};--a:${t.a};--b:${t.b};--card:${t.card};--line:${t.line}`;

export const FONT = `-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif`;

/** A short string, trimmed and capped, or the fallback. */
export const str = (v: unknown, fallback: string, max = 160) => {
  const s = typeof v === "string" ? v.trim() : "";
  return (s || fallback).slice(0, max);
};

export const list = <T>(v: unknown, max: number): T[] => (Array.isArray(v) ? (v.slice(0, max) as T[]) : []);
