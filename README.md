# fileroute (`fr`)

[![npm version](https://img.shields.io/npm/v/@arindam1729/fr.svg)](https://www.npmjs.com/package/@arindam1729/fr)
[![CI](https://github.com/Arindam200/fr/actions/workflows/ci.yml/badge.svg)](https://github.com/Arindam200/fr/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/@arindam1729/fr.svg)](https://nodejs.org)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Ask a question about a codebase and get back the files that matter.**

`fr` sends each file to [TypeSafe's Jev](https://typesafe.ai), a fast "System 1" decision
model. Jev labels each file **relevant**, **maybe** or **irrelevant** and gives a
confidence score. All files are checked in parallel, and results appear on screen as they
arrive, often while you're still typing.

```
╭────────────────────────────────────────────────────────────────────────╮
│ ▗▄▄▖       fileroute ➜ v0.1.0                                          │
│ ▐██▙▄▄▄▖   find the files that matter, with Jev                        │
│ ▐█▘▐█▘▐█▌  ~/code/my-app                                               │
│ ▝▀▀▀▀▀▀▀▘  10 files indexed · jev-latest                               │
╰────────────────────────────────────────────────────────────────────────╯

? where is login handled
● relevant   100%  src/auth/login.ts     323ms
◐ maybe       93%  src/auth/session.ts   465ms
✓ 10 files · 1 relevant, 2 maybe · 467ms   enter keep · esc clear
```

- **No index to build.** Nothing is embedded or stored ahead of time. `fr` scans the folder
  and starts answering right away.
- **Results update as you type.** A short pause in typing starts a search. A newer
  question cancels the one still running.
- **Answers are cached.** Each file's answer is saved for that question. Backspacing to an
  earlier question or recalling one from history shows the saved results immediately.
- **No runtime dependencies.** It's a single Node.js CLI.

## Install

```sh
npm install -g @arindam1729/fr
```

Requires Node.js 22 or newer. You can also run it without installing:
`npx @arindam1729/fr`.

## Quick start

1. Get a TypeSafe API key at [typesafe.ai](https://typesafe.ai).
2. Make it available to `fr`, either as an environment variable or in a `.env` file in the
   folder you run `fr` from:

   ```sh
   export TYPESAFE_API_KEY=your-key
   ```

3. Run it in a project:

   ```sh
   cd ~/code/my-app
   fr
   ```

## Usage

```
fr [path]                     interactive: index path (default .), then search as you type
fr "<question>" [path]        one-shot: answer a single question and exit
fr --help
```

### Interactive mode

`fr` or `fr <dir>` scans the directory once and opens a live prompt. Results show under the
prompt as you type. While a new search runs, the previous results stay on screen, dimmed,
until the new ones arrive. Press **Enter** to keep the results in your terminal history and
start a new question.

| Key | Action |
|---|---|
| typing | results update as you type |
| `Enter` | keep the results in the scrollback and start a new question |
| `Esc` / `Ctrl+C` | clear the question (`Ctrl+C` on an empty prompt quits) |
| `↑` / `↓` | question history |
| `Tab` | complete a `:command` |
| `Ctrl+A/E/U/K/W`, `Alt+←/→` | usual readline editing |
| `Ctrl+D` | quit |

| Command | Action |
|---|---|
| `:all` | toggle showing irrelevant files |
| `:min relevant\|maybe` | lowest tier to show |
| `:reindex` | rescan files from disk |
| `:help` | show keys and commands |
| `:q` | quit |

With `--no-live`, or when input is piped in, `fr` switches to a simpler line mode: type a
question, press Enter, and press `Ctrl+C` to cancel a running query.

### One-shot mode

```sh
fr "How are database connections pooled and closed?" ./src
```

Results are printed as they arrive, followed by a summary line. Add `--json` for
machine-readable output that works well in scripts or as input to another tool:

```sh
fr "where are invoices generated?" --json | jq '.results[] | select(.answer == "relevant") | .path'
```

The exit code is non-zero if the search was cancelled or an API call failed.

### Options

| Flag | Default | Description |
|---|---|---|
| `-i, --interactive` | | force interactive mode |
| `--no-live` | | interactive mode without search-as-you-type |
| `--min <relevant\|maybe>` | `maybe` | lowest tier to show |
| `--all` | | also list irrelevant files |
| `--json` | | JSON output (one-shot only) |
| `--concurrency <n>` | `16` | how many files are checked at once |
| `--max-files <n>` | `2000` | maximum number of files to scan |
| `-h, --help` | | show help |

## Configuration

| Environment variable | Required | Default |
|---|---|---|
| `TYPESAFE_API_KEY` | yes | none. Get one at [typesafe.ai](https://typesafe.ai) |
| `JEV_MODEL` | no | `jev-latest` |
| `JEV_URL` | no | `https://api.typesafe.ai/v1/systemone` |

`fr` reads a `.env` file from the current directory if one exists. Variables already set in
your environment take precedence. See [`.env.example`](.env.example).

## How it works

1. **Scan.** `fr` walks the directory and collects text files. It skips hidden files, common
   build and dependency folders (`node_modules`, `.git`, `dist`, `build`, `.next`, `target`,
   `venv`, …), binaries and media, lockfiles, and files larger than 200 KB. For each file it
   keeps a short preview: the path plus the first 40 lines, up to 1,500 characters.
2. **Decide.** For each question, `fr` sends every preview to Jev in parallel, asking whether
   the file is useful for answering the question. Jev picks `relevant`, `maybe` or
   `irrelevant` and returns a confidence score.
3. **Rank.** Results show as soon as each answer arrives, sorted by tier and then by
   confidence.

## Privacy

`fr` uploads the **path and the first ~1,500 characters of every scanned file** to the
TypeSafe API each time you ask a question. Don't run it on code you aren't allowed to send
to a third-party API. Use `--max-files` or run it in a subfolder to limit what gets sent.
Hidden files such as `.env` are never read.

## Try it on the sample project

This repository includes a small sample codebase under [`sample/`](sample) to experiment with:

```sh
git clone https://github.com/Arindam200/fr.git && cd fr
npm install
cp .env.example .env        # then paste your key
npm run interactive         # interactive search over ./sample
npm run demo                # one-shot example question
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: `npm run dev` runs the TypeScript sources
directly, `npm run typecheck` checks types, and `npm run build` compiles to `dist/`.

## License

[MIT](LICENSE) © Arindam Majumder
