#!/usr/bin/env node
import { parseArgs } from "node:util";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { createRequire } from "node:module";
import { collectFiles, type FileEntry } from "./walk.ts";
import { jevConfig, type JevConfig } from "./decide.ts";
import { byRank, clearCache, rank, search, type Answer, type Row } from "./search.ts";
import { banner, bold, dim, formatRow, green, red, summary, useColor } from "./format.ts";
import { live } from "./live.ts";

// ../package.json resolves from both src/ (dev) and dist/ (published).
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

// Load ./.env if present (TYPESAFE_API_KEY etc.); real env vars take precedence.
if (existsSync(".env")) process.loadEnvFile(".env");

const HELP = `fr - find the files that matter, with TypeSafe's Jev decision model

usage:
  fr [path]                     interactive: index path (default .), then search as you type
  fr "<question>" [path]        one-shot: answer a single question and exit
  fr --help

options:
  -i, --interactive         force interactive mode
  --no-live                 interactive without search-as-you-type: ask, then press enter
  --concurrency <n>         parallel decisions (default 16)
  --max-files <n>           cap files scanned (default 2000)
  --min <relevant|maybe>    lowest tier to show (default maybe)
  --all                     also list irrelevant files
  --json                    machine-readable output (one-shot only)

interactive commands:
  :all        toggle showing irrelevant files
  :min <t>    lowest tier to show (relevant|maybe)
  :reindex    rescan files from disk
  :help       show commands
  :q          quit (or Ctrl+D)

interactive keys:
  typing      results update as you type (a short pause fires the search)
  enter       keep the results in the scrollback and start a new question
  esc         clear the question (Ctrl+C too; Ctrl+C on an empty prompt quits)
  up/down     question history · tab completes a :command
  with --no-live or piped input, Enter asks and Ctrl+C cancels a running query

env:
  TYPESAFE_API_KEY          required
  JEV_MODEL                 default jev-latest
  JEV_URL                   default https://api.typesafe.ai/v1/systemone`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  allowNegative: true,
  options: {
    interactive: { type: "boolean", short: "i", default: false },
    live: { type: "boolean", default: true },
    concurrency: { type: "string", default: "16" },
    "max-files": { type: "string", default: "2000" },
    min: { type: "string", default: "maybe" },
    all: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();
// `fr` or `fr <dir>` is interactive; `fr "<question>" [dir]` is one-shot.
const interactive = values.interactive || positionals.length === 0 || (positionals.length === 1 && isDir(positionals[0]));
const oneShotQuestion = interactive ? undefined : positionals[0];
const root = resolve((interactive ? positionals[0] : positionals[1]) ?? ".");

let jev: JevConfig;
try {
  jev = jevConfig();
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
}
if (!isDir(root)) {
  console.error(`error: not a directory: ${root}`);
  process.exit(1);
}

const tty = Boolean(process.stdout.isTTY) && !values.json;
useColor(tty);
const clearLine = () => tty && process.stdout.write("\r\x1b[K");

const settings: { all: boolean; min: Answer } = { all: values.all, min: values.min === "relevant" ? "relevant" : "maybe" };
const maxFiles = Number(values["max-files"]);
const conc = Math.max(1, Number(values.concurrency));

const visible = (a: Answer) => settings.all || rank[a] <= rank[settings.min];

let files: FileEntry[] = [];
const index = async () => (files = await collectFiles(root, maxFiles));

// Line-mode query: prints each result the moment Jev returns it, with a live progress
// counter on the last line.
async function runQuery(question: string, signal: AbortSignal): Promise<Row[]> {
  const wall = performance.now();
  let decided = 0;
  let hits = 0;
  const progress = () =>
    tty && process.stdout.write(`\r\x1b[K${dim(`deciding ${decided}/${files.length} · ${hits} relevant · ${Math.round(performance.now() - wall)}ms`)}`);

  if (!values.json) console.log(`\n${bold(question)}\n`);
  progress();
  const { rows, failure } = await search(question, files, jev, conc, signal, (row) => {
    decided++;
    if (row.answer === "relevant") hits++;
    if (!values.json && visible(row.answer)) {
      clearLine();
      console.log(formatRow(row));
    }
    progress();
  });
  clearLine();

  const wallMs = Math.round(performance.now() - wall);
  const model = rows[0]?.model ?? jev.model;
  if (failure) console.error(`${red("error:")} ${failure.message}`);

  if (values.json) {
    rows.sort(byRank);
    const avgDecisionMs = rows.length ? Math.round(rows.reduce((s, r) => s + r.latencyMs, 0) / rows.length) : 0;
    const inputTokens = rows.reduce((s, r) => s + r.inputTokens, 0);
    console.log(JSON.stringify({ question, root, model, scanned: rows.length, wallMs, avgDecisionMs, inputTokens, results: rows }, null, 2));
    return rows;
  }

  if (rows.length && !rows.some((r) => visible(r.answer))) console.log(dim("no matching files"));
  console.log(`\n${dim(summary(rows, files.length, wallMs, model, signal.aborted))}`);
  return rows;
}

// Interactive :commands, shared by live and line mode. Returns text to print, or
// undefined to quit.
async function command(line: string): Promise<string | undefined> {
  const [cmd, arg] = line.slice(1).trim().split(/\s+/);
  if (cmd === "q" || cmd === "quit" || cmd === "exit") return undefined;
  if (cmd === "all") return dim(`showing irrelevant files: ${(settings.all = !settings.all)}`);
  if (cmd === "min" && (arg === "relevant" || arg === "maybe")) return dim(`min tier: ${(settings.min = arg)}`);
  if (cmd === "reindex") {
    clearCache();
    return dim(`${(await index()).length} files indexed`);
  }
  return HELP.slice(HELP.indexOf("interactive commands:"), HELP.indexOf("\nenv:"));
}

await index();
if (files.length === 0) console.error(`No searchable files under ${root}`);

// ---------------------------------------------------------------------------
// One-shot mode
// ---------------------------------------------------------------------------
if (oneShotQuestion) {
  if (files.length === 0) process.exit(1);
  const ac = new AbortController();
  process.once("SIGINT", () => ac.abort());
  const rows = await runQuery(oneShotQuestion, ac.signal);
  process.exit(rows.length === files.length ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Interactive mode: search-as-you-type in a terminal, line mode for pipes/--no-live
// ---------------------------------------------------------------------------
const liveMode = values.live && tty && Boolean(process.stdin.isTTY);
console.log(`\n${banner({ version, root, files: files.length, model: jev.model })}\n`);
console.log(dim(liveMode ? "Ask a question about the code; results update as you type. :help for keys, :q to quit." : "Ask a question about the code. :help for commands, :q to quit."));

if (liveMode) {
  console.log();
  await live({
    files: () => files,
    search: (question, signal, onRow) => search(question, files, jev, conc, signal, onRow),
    visible,
    command,
    model: jev.model,
  });
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
rl.setPrompt(`\n${green("?")} `);
let running: AbortController | undefined;
let closed = false;
rl.on("close", () => (closed = true));
// Ctrl+C cancels the running query; at an idle prompt it quits.
rl.on("SIGINT", () => {
  if (running) running.abort();
  else rl.close();
});

rl.prompt();
// Lines are buffered by the iterator, so piped input and typing ahead both work;
// the loop ends on Ctrl+D / EOF once the current query finishes.
for await (const raw of rl) {
  const line = raw.trim();
  if (line.startsWith(":")) {
    const text = await command(line);
    if (text === undefined) break;
    console.log(text);
  } else if (line && files.length) {
    running = new AbortController();
    await runQuery(line, running.signal);
    running = undefined;
  }
  if (!closed) rl.prompt();
}
rl.close();
console.log();
