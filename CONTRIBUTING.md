# Contributing

Thanks for your interest in improving `fr`! Bug reports, ideas and pull requests are all welcome.

## Setup

```sh
git clone https://github.com/Arindam200/fr.git && cd fr
npm install
cp .env.example .env    # add your TYPESAFE_API_KEY
```

`npm run dev` runs the TypeScript sources directly using Node's built-in type stripping.
That needs Node.js 22.18+ or 23.6+. The published package is compiled JavaScript and runs on
Node.js 22+.

| Script | What it does |
|---|---|
| `npm run dev -- [args]` | run the CLI from `src/` |
| `npm run interactive` | interactive search over `./sample` |
| `npm run demo` | one-shot example question over `./sample` |
| `npm run typecheck` | type-check with `tsc` |
| `npm run build` | compile `src/` to `dist/` |

## Project layout

```
src/
  cli.ts      argument parsing, one-shot and line modes, banner
  live.ts     search-as-you-type terminal UI
  search.ts   runs one question against every file in parallel, with a cache
  decide.ts   the only file that talks to the Jev API
  walk.ts     directory walk and file previews
  format.ts   colors, result rows, summary line, welcome box
sample/       a tiny codebase to try fr on
```

## Guidelines

- Keep runtime dependencies at zero. Use only Node's standard library.
- Only use TypeScript syntax that Node can strip without transpiling: no enums, namespaces
  or parameter properties. `tsc` enforces this with `erasableSyntaxOnly`.
- Import local files with a `.ts` extension. The build rewrites it to `.js`.
- Run `npm run typecheck && npm run build` before opening a PR.
- For user-facing changes, add an entry under an "Unreleased" heading in `CHANGELOG.md`.

## Releasing (maintainers)

1. Bump the version: `npm version patch|minor|major`. This updates `package.json` and creates
   a git tag.
2. Move the "Unreleased" changelog entries under the new version.
3. `git push --follow-tags`, then create a GitHub release from the tag. The `publish`
   workflow publishes the release to npm.
