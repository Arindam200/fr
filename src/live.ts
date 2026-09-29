// Search-as-you-type. The prompt owns the terminal (raw mode) and redraws a small frame in
// place - input line, ranked results, status line - on every keystroke and every decision.
// A pause in typing fires a query; a newer query aborts the older one. Results of the last
// query stay on screen (dimmed) until the new one has something to show, so nothing flickers.
import { emitKeypressEvents } from "node:readline";
import type { FileEntry } from "./walk.ts";
import { byRank, normalize, type Answer, type Row, type SearchResult } from "./search.ts";
import { bold, cyan, dim, fit, formatRow, green, red, summary, yellow } from "./format.ts";

export type LiveOptions = {
  files: () => FileEntry[];
  search: (question: string, signal: AbortSignal, onRow: (row: Row) => void) => Promise<SearchResult>;
  visible: (a: Answer) => boolean;
  command: (line: string) => Promise<string | undefined>; // text to print; undefined = quit
  model: string;
};

type Key = { name?: string; ctrl?: boolean; meta?: boolean };

type Run = {
  question: string;
  total: number;
  rows: Row[];
  started: number;
  ms?: number; // set once finished (or aborted)
  failure?: Error;
  ctrl: AbortController;
  done: Promise<void>;
};

const DEBOUNCE_MS = 150; // typing pause before a query fires
const MIN_CHARS = 3;
const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const PLACEHOLDER = "ask about the code, e.g. where is login handled?";
const COMMANDS: [string, string][] = [
  [":all", "toggle showing irrelevant files"],
  [":min relevant", "show only relevant files"],
  [":min maybe", "show relevant and maybe files"],
  [":reindex", "rescan files from disk"],
  [":help", "keys and commands"],
  [":q", "quit"],
];

export function live(opts: LiveOptions): Promise<void> {
  const out = process.stdout;
  const stdin = process.stdin;
  let input = "";
  let cursor = 0;
  const history: string[] = [];
  let histIdx = 0;
  let draft = "";
  let run: Run | undefined; // latest query, possibly in flight
  let shown: Run | undefined; // what the list displays; lags `run` until it has rows to show
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let tick = 0;
  let queued = false;
  let pasting = false;
  let closed = false;
  // While a question is being kept (waiting for its last decisions) or a :command runs,
  // keystrokes are buffered and replayed afterwards, like readline's type-ahead.
  let hold: "commit" | "command" | undefined;
  let buffered: [string | undefined, Key][] = [];
  let finish = () => {};

  const isCommand = () => input.trimStart().startsWith(":");

  // ---- queries -------------------------------------------------------------

  function start(question: string) {
    run?.ctrl.abort();
    const r: Run = { question, total: opts.files().length, rows: [], started: performance.now(), ctrl: new AbortController(), done: Promise.resolve() };
    run = r;
    r.done = opts
      .search(question, r.ctrl.signal, (row) => {
        r.rows.push(row);
        if (run === r && opts.visible(row.answer)) shown = r;
        later();
      })
      .then(({ failure }) => {
        r.ms = Math.round(performance.now() - r.started);
        r.failure = failure;
        if (run === r) shown = r;
        later();
      });
  }

  // Called after every edit: schedule a query for the new text, or drop the old one.
  function changed(delay = DEBOUNCE_MS) {
    clearTimeout(debounce);
    debounce = undefined;
    const q = normalize(input);
    if (isCommand() || q.length < MIN_CHARS) {
      run?.ctrl.abort();
      run = undefined;
      if (!q) shown = undefined;
    } else if (q !== run?.question) {
      debounce = setTimeout(() => {
        debounce = undefined;
        start(q);
        render();
      }, delay);
    }
    render();
  }

  // Enter on a question: wait for its remaining decisions, then print it to the scrollback.
  function submit() {
    const line = input.trim();
    if (!line) return;
    if (history.at(-1) !== line) history.push(line);
    histIdx = history.length;
    if (isCommand()) return void runCommand(line);
    if (!opts.files().length) return;
    const q = normalize(line);
    clearTimeout(debounce);
    debounce = undefined;
    if (run?.question !== q) start(q); // typed faster than the debounce
    const r = run!;
    hold = "commit";
    r.done.then(() => commit(r));
    render();
  }

  function commit(r: Run) {
    const rows = r.rows.filter((x) => opts.visible(x.answer)).sort(byRank);
    const pad = Math.min(60, Math.max(0, ...rows.map((x) => x.path.length)));
    const lines = [`${green("?")} ${bold(r.question)}`, ...rows.map((x) => formatRow(x, pad))];
    if (!rows.length && r.rows.length) lines.push(dim("no matching files"));
    if (r.failure) lines.push(`${red("error:")} ${r.failure.message}`);
    lines.push("", dim(summary(r.rows, r.total, r.ms ?? 0, r.rows[0]?.model ?? opts.model, r.ctrl.signal.aborted)), "");
    run = shown = undefined;
    input = "";
    cursor = 0;
    release(lines.join("\n"));
  }

  async function runCommand(line: string) {
    hold = "command";
    input = "";
    cursor = 0;
    changed();
    const text = await opts.command(line);
    if (text === undefined) return quit();
    release(`${green("?")} ${line}\n${text}\n`);
  }

  // Prints `text` permanently above the live frame, then replays buffered keystrokes.
  function release(text: string) {
    hold = undefined;
    out.write(`\r\x1b[J${text}\n`);
    render();
    const keys = buffered;
    buffered = [];
    for (const [s, k] of keys) onKey(s, k);
  }

  // ---- drawing -------------------------------------------------------------

  function later() {
    if (queued) return;
    queued = true;
    setTimeout(render, 16);
  }

  function render() {
    queued = false;
    if (closed) return;
    const busy = Boolean(debounce || hold === "commit" || (run && run.ms === undefined));
    if (busy && !ticker) ticker = setInterval(() => (tick++, render()), 80);
    if (!busy && ticker) {
      clearInterval(ticker);
      ticker = undefined;
    }

    const width = out.columns || 80;
    // Input line, scrolled horizontally so the cursor stays in view.
    const room = width - 4;
    const off = Math.max(0, cursor - room);
    const text = off ? dim("…") + input.slice(off + 1, off + room) : input.slice(0, room);
    const lines = [`${green("?")} ${input ? text : dim(PLACEHOLDER)}`, ...body()];
    const up = lines.length - 1;
    // The cursor always rests on the input line (the frame's top), so each redraw starts
    // with "\r, clear to end of screen". Wrapped in synchronized-output + hidden cursor.
    out.write(
      "\x1b[?2026h\x1b[?25l\r\x1b[J" +
        lines.map((l) => fit(l, width - 1)).join("\n") +
        (up ? `\x1b[${up}A` : "") +
        `\x1b[${3 + cursor - off}G\x1b[?25h\x1b[?2026l`,
    );
  }

  function body(): string[] {
    const total = opts.files().length;
    if (!total) return [yellow("no searchable files · :reindex to rescan")];
    if (isCommand()) {
      const typed = input.trim();
      const matches = COMMANDS.filter(([cmd]) => cmd.startsWith(typed));
      if (!matches.length) return [dim("unknown command · enter shows help")];
      return [...matches.map(([cmd, desc]) => `  ${cyan(cmd.padEnd(15))}${dim(desc)}`), dim("tab complete · enter run")];
    }
    const q = normalize(input);
    if (!q) return [dim("results update as you type · enter keep · esc clear · ↑↓ history · :help")];
    if (q.length < MIN_CHARS) return [dim("keep typing…")];

    const lines: string[] = [];
    if (shown) {
      const stale = shown.question !== q;
      const rows = shown.rows.filter((r) => opts.visible(r.answer)).sort(byRank);
      const max = Math.max(3, Math.min(10, (out.rows || 24) - 6));
      const pad = Math.max(0, ...rows.slice(0, max).map((r) => r.path.length));
      lines.push(...rows.slice(0, max).map((r) => formatRow(r, pad, stale)));
      if (rows.length > max) lines.push(dim(`  … ${rows.length - max} more · enter lists all`));
      if (!rows.length && !stale && shown.ms !== undefined && !shown.failure) lines.push(dim("no matching files"));
    }

    const r = run?.question === q ? run : undefined;
    const spin = cyan(SPINNER[tick % SPINNER.length]);
    const hits = r ? r.rows.filter((x) => x.answer === "relevant").length : 0;
    if (hold === "commit" && r) lines.push(`${spin} ${dim(`finishing ${r.rows.length}/${r.total} · ctrl+c to stop early`)}`);
    else if (r?.failure) lines.push(`${red("error:")} ${r.failure.message}`);
    else if (r && r.ms === undefined) {
      lines.push(`${spin} ${dim(`deciding ${r.rows.length}/${r.total} · ${hits} relevant · ${Math.round(performance.now() - r.started)}ms`)}`);
    } else if (debounce) lines.push(`${spin} ${dim(`deciding ${total} files…`)}`);
    else if (r) {
      const maybes = r.rows.filter((x) => x.answer === "maybe").length;
      const cached = r.rows.every((x) => x.cached) ? " · cached" : "";
      lines.push(`${green("✓")} ${dim(`${r.rows.length} files · ${hits} relevant, ${maybes} maybe · ${r.ms}ms${cached}`)}   ${dim("enter keep · esc clear")}`);
    }
    return lines;
  }

  // ---- editing -------------------------------------------------------------

  const clamp = (i: number) => Math.max(0, Math.min(input.length, i));
  function wordLeft() {
    let i = cursor;
    while (i > 0 && input[i - 1] === " ") i--;
    while (i > 0 && input[i - 1] !== " ") i--;
    return i;
  }
  function wordRight() {
    let i = cursor;
    while (i < input.length && input[i] === " ") i++;
    while (i < input.length && input[i] !== " ") i++;
    return i;
  }
  function move(i: number) {
    cursor = clamp(i);
    render();
  }
  function del(from: number, to: number) {
    [from, to] = [clamp(from), clamp(to)];
    if (from >= to) return;
    input = input.slice(0, from) + input.slice(to);
    cursor = from;
    changed();
  }
  function insert(s: string) {
    s = s.replace(/[\r\n\t]/g, " ").replace(/[\x00-\x1f\x7f]/g, "");
    if (!s) return;
    input = input.slice(0, cursor) + s + input.slice(cursor);
    cursor += s.length;
    if (!pasting) changed();
  }
  function clear() {
    input = "";
    cursor = 0;
    histIdx = history.length;
    changed();
  }
  function recall(dir: -1 | 1) {
    const i = histIdx + dir;
    if (i < 0 || i > history.length) return;
    if (histIdx === history.length) draft = input;
    histIdx = i;
    input = i === history.length ? draft : history[i];
    cursor = input.length;
    changed(0); // recalled questions run at once, and are usually cache hits
  }
  function complete() {
    const match = isCommand() && COMMANDS.find(([cmd]) => cmd.startsWith(input.trim()));
    if (match) move((input = match[0]).length);
  }

  function onKey(str: string | undefined, key: Key = {}) {
    const { name, ctrl, meta } = key;
    if (closed) return;
    if (hold) {
      if (ctrl && name === "c" && hold === "commit") run?.ctrl.abort(); // keep what's decided so far
      else buffered.push([str, key]);
      return;
    }
    if (name === "paste-start") return void (pasting = true);
    if (name === "paste-end") return void ((pasting = false), changed());
    if (pasting) return insert(str ?? "");

    if (ctrl && name === "c") return input ? clear() : quit();
    if (ctrl && name === "d") return input ? del(cursor, cursor + 1) : quit();
    if (name === "return" || name === "enter") return submit();
    if (name === "escape") return clear();
    if (name === "tab") return complete();
    if (ctrl && name === "l") return void (out.write("\x1b[2J\x1b[H"), render());
    if (name === "up" || (ctrl && name === "p")) return recall(-1);
    if (name === "down" || (ctrl && name === "n")) return recall(1);
    if (name === "backspace") return meta ? del(wordLeft(), cursor) : del(cursor - 1, cursor);
    if (name === "delete") return del(cursor, cursor + 1);
    if (ctrl && name === "w") return del(wordLeft(), cursor);
    if (ctrl && name === "u") return del(0, cursor);
    if (ctrl && name === "k") return del(cursor, input.length);
    if (meta && name === "d") return del(cursor, wordRight());
    if (((meta || ctrl) && name === "left") || (meta && name === "b")) return move(wordLeft());
    if (((meta || ctrl) && name === "right") || (meta && name === "f")) return move(wordRight());
    if (name === "left" || (ctrl && name === "b")) return move(cursor - 1);
    if (name === "right" || (ctrl && name === "f")) return move(cursor + 1);
    if (name === "home" || (ctrl && name === "a")) return move(0);
    if (name === "end" || (ctrl && name === "e")) return move(input.length);
    if (str && !ctrl && !meta) insert(str);
  }

  // ---- lifecycle -----------------------------------------------------------

  function quit() {
    closed = true;
    run?.ctrl.abort();
    clearTimeout(debounce);
    clearInterval(ticker);
    out.write("\r\x1b[J\x1b[?2004l"); // erase the frame; the scrollback above stays
    stdin.off("keypress", onKey);
    out.off("resize", render);
    stdin.setRawMode(false);
    stdin.pause();
    finish();
  }

  // Passing escapeCodeTimeout makes a bare Esc register in 50ms instead of Node's 500ms.
  emitKeypressEvents(stdin, { escapeCodeTimeout: 50 } as never);
  stdin.setRawMode(true);
  stdin.on("keypress", onKey);
  stdin.resume();
  out.on("resize", render);
  out.write("\x1b[?2004h"); // bracketed paste: a pasted newline must not submit
  process.once("exit", () => out.write("\x1b[?2004l\x1b[?25h"));
  render();
  return new Promise((resolve) => (finish = resolve));
}
