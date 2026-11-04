# Contributing to ChatGPTBox

ChatGPTBox is a Preact extension built with Webpack for Chromium and Firefox.
Optional local Node.js processes provide its API gateway and MCP server.
Start with the [documentation map](docs/README.md) for product/interface owners
and [architecture](ARCHITECTURE.md) for code boundaries.

## Setup

[Package engines](package.json) require Node.js 22 or newer, and
[PR CI](.github/workflows/pr-tests.yml) uses Node.js 22. With nvm:

```bash
nvm use 22
npm ci
```

Use the lockfile through `npm ci` for a reproducible install. A session-specific
instruction may select a different available runtime for a bounded check; state
that limitation rather than changing the project's supported version.

## Commands and affected checks

| Task | Command | What it establishes |
| --- | --- | --- |
| Documentation structure | `npm run docs:check` | Metadata, lifecycle relationships, local links and headings |
| Documentation checker fixtures | `npm run docs:test` | Positive and negative checker behavior; no external dependencies |
| Lint | `npm run lint` | Configured JS/JSX/MJS rules |
| Unit/integration tests | `npm test` | Vitest suite with controlled external boundaries |
| Focused tests | `npm test -- tests/browser-assistant.test.mjs` | Named test scope only |
| Large history export | `node scripts/check-history-backup-resources.mjs` | Synthetic 1,200-conversation / 300 MiB export with a 128 MiB V8 old-space limit; local resource regression, not a browser heap guarantee |
| Search engine tables | `npm run verify` | Search integration configuration checks |
| Development build/watch | `npm run dev` | Unpacked browser builds with watch mode |
| Production bundles | `npm run build` | Normal and reduced Chromium/Firefox archives |
| Installed extension update | `npm run build:extension` | Builds and replaces the Chromium install at `../browser-extensions/chatgptbox`; use when an installed extension update is intended |
| API gateway | `npm run api-server` | Local gateway process; see its authentication and bridge prerequisites |
| MCP server | `npm run mcp-server` | Local MCP process; requires the API gateway |
| Existing source formatting | `npm run pretty` | Writes JS/MJS/JSX/JSON/CSS formatting; does not format Markdown |

For prose changes, run `docs:check` and review the affected source and reader path.
For checker/policy changes, also run `docs:test` and lint changed JavaScript.
For runtime changes, run affected tests and lint; add production builds and
browser observations when the change affects packaging or user interaction.
Passing a fixture does not establish live login, provider quality, or real-site
compatibility. Record limitations under the
[verification rule](docs/contracts/development.md#verify-promises-and-effects).

## Browser builds

`npm run dev` emits `build/chromium/` and `build/firefox/`.

- Chrome/Edge: enable Developer mode on the extensions page and load
  `build/chromium/` as an unpacked extension.
- Firefox: open `about:debugging#/runtime/this-firefox`, choose Load Temporary
  Add-on, and select `build/firefox/manifest.json`.
- Chat requests require configured credentials or a logged-in web provider.
  `UNAUTHORIZED` without these does not by itself indicate a build failure.
  Page entry, selection, and settings behavior can be checked independently.

After replacing files in an unpacked extension, explicitly **Reload** that
extension on the browser's extensions page, then refresh the source/test pages.
A browser restart or new files on disk alone did not replace a cached background
in the [native-input trial](docs/evidence/2026-10-30-chatgpt-native-input.md#reviews-and-corrections).
Check the running protocol/behavior before attributing a mixed-version failure
to the new implementation. This does not authorize updating a user's installation
when only a disposable test build is intended.

The production command runs two passes with a ten-second pause and produces:

- `build/chromium.zip`
- `build/firefox.zip`
- `build/chromium-without-katex-and-tiktoken.zip`
- `build/firefox-without-katex-and-tiktoken.zip`

Safari packaging and `build:safari` are retired. The removed `test:agent` and
extension-internal assistant/ZIP-skill/MCP runtime are not development targets.
DeepSeek Harness features are a client of the external engine.

## Code and document changes

Use existing ESM, Preact, Tailwind, and `webextension-polyfill` patterns. Keep
provider logic, shared state, module APIs, and UI at the owners documented by
[architecture](ARCHITECTURE.md). Check existing implementations before adding
another. Preserve unrelated working changes.

For behavior changes, reconcile the applicable product/interface owner under
[development discipline](docs/contracts/development.md). For documentation,
follow [documentation discipline](docs/contracts/documentation.md): use the
existing owner, preserve decision sources, and distinguish current behavior,
targets, plans, and historical evidence. Existing Chinese product documents and
both README languages remain supported.

## Pull requests and hooks

Describe the concrete problem, resulting behavior, validation, and limits.
Documentation PRs explain which reading path or contradiction was repaired.
Do not mark unrun browser or live-provider checks as passed.

[PR tests](.github/workflows/pr-tests.yml) run lint, Vitest, and a build for their
declared paths. The separate [documentation job](.github/workflows/docs-check.yml)
runs checker fixtures and repository documentation checks, including for docs-only
changes. [Configuration CI](.github/workflows/verify-configs.yml) checks search
tables. These are distinct checks; none alone proves full product acceptance.

The pre-commit hook runs `pretty`, `stage`, and `lint`. It can format source and
restage files that were already staged. Inspect the diff before committing.
If lint fails, correct the affected files and retry; do not bypass the hook or
run a broad auto-fix without inspecting its effects.
