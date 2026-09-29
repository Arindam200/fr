// Terminal presentation shared by one-shot, line and live modes.
import type { Answer, Row } from "./search.ts";

let color = false;
export const useColor = (on: boolean) => void (color = on);
const c = (code: number | string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
export const green = c(32), yellow = c(33), red = c(31), cyan = c(36), dim = c(2), bold = c(1);
const accent = c("38;5;215");

// `pad` aligns the latency column; `muted` renders the whole row dim (stale live results).
export function formatRow(r: Row, pad = 0, muted = false) {
  const tag = r.answer === "relevant" ? "● relevant  " : r.answer === "maybe" ? "◐ maybe     " : "○ irrelevant";
  const pct = `${String(Math.round(r.confidence * 100)).padStart(3)}%`;
  const ms = r.cached ? "cached" : `${r.latencyMs}ms`;
  if (muted) return dim(`${tag} ${pct}  ${r.path.padEnd(pad)}  ${ms}`);
  const color = r.answer === "relevant" ? green : r.answer === "maybe" ? yellow : dim;
  return `${color(tag)} ${pct}  ${cyan(r.path.padEnd(pad))}  ${dim(ms)}`;
}

export function summary(rows: Row[], total: number, wallMs: number, model: string, cancelled = false) {
  const fresh = rows.filter((r) => !r.cached);
  const count = (a: Answer) => rows.filter((r) => r.answer === a).length;
  const avgMs = Math.round(fresh.reduce((s, r) => s + r.latencyMs, 0) / fresh.length);
  return [
    `${cancelled ? "cancelled · " : ""}${rows.length}/${total} files in ${wallMs}ms`,
    fresh.length && `avg ${avgMs}ms/decision`,
    `${count("relevant")} relevant, ${count("maybe")} maybe`,
    fresh.length && `${fresh.reduce((s, r) => s + r.inputTokens, 0)} input tokens`,
    fresh.length < rows.length && `${rows.length - fresh.length} cached`,
    model,
  ]
    .filter(Boolean)
    .join(" · ");
}

// The welcome box shown when interactive mode starts: a little folder critter beside the
// name, tagline, indexed root and model.
const LOGO = ["▗▄▄▖     ", "▐██▙▄▄▄▖ ", "▐█▘▐█▘▐█▌", "▝▀▀▀▀▀▀▀▘"];
export function banner(o: { version: string; root: string; files: number; model: string }) {
  const home = process.env.HOME;
  const root = home && o.root.startsWith(home) ? `~${o.root.slice(home.length)}` : o.root;
  const text = [
    `${bold("fileroute")} ${accent("➜")} ${dim(`v${o.version}`)}`,
    dim("find the files that matter, with Jev"),
    cyan(root),
    dim(`${o.files} files indexed · ${o.model}`),
  ];
  const inner = Math.max(40, Math.min(72, (process.stdout.columns || 80) - 2));
  const border = (l: string, r: string) => accent(l + "─".repeat(inner) + r);
  const row = (s: string) => {
    s = fit(s, inner - 2);
    return `${accent("│")} ${s}${" ".repeat(Math.max(0, inner - 2 - visibleWidth(s)))} ${accent("│")}`;
  };
  return [
    border("╭", "╮"),
    ...LOGO.map((l, i) => row(`${accent(l)}  ${text[i]}`)),
    border("╰", "╯"),
  ].join("\n");
}

// Cuts a (possibly colored) line to `width` visible columns so it never wraps.
const SGR = /\x1b\[[0-9;]*m/g;
const visibleWidth = (s: string) => [...s.replace(SGR, "")].length;
export function fit(s: string, width: number) {
  if (visibleWidth(s) <= width) return s;
  let room = width - 1, out = "";
  for (const part of s.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith("\x1b[")) out += part;
    else if (room > 0) {
      const chars = [...part].slice(0, room);
      out += chars.join("");
      room -= chars.length;
    }
  }
  return out.includes("\x1b[") ? `${out}…\x1b[0m` : `${out}…`;
}
