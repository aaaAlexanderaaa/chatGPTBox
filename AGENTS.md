# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds extension source code (background, content scripts, popup, pages, shared UI, services, and utils).
- `src/_locales/` contains i18n message bundles; update these for user-facing strings.
- `src/manifest.json` and `src/manifest.v2.json` define extension metadata.
- `safari/` contains Safari-specific packaging scripts; `screenshots/` stores marketing assets.
- `build/` is generated output (do not edit by hand).

## Build, Test, and Development Commands
- `npm install` (or `npm ci`) installs dependencies.
- `npm run dev` creates a development build in `build/`.
- `npm run build` produces production bundles in `build/`.
- `npm run build:safari` packages the Safari build.
- `npm run analyze` builds with bundle analysis enabled.
- `npm run lint` and `npm run lint:fix` run ESLint checks and auto-fixes.
- `npm run pretty` formats files with Prettier.
- `npm run verify` validates search engine config files used by the extension.

## Coding Style & Naming Conventions
- JavaScript/JSX uses 2-space indentation, single quotes, no semicolons, and 100-column lines (see `.prettierrc`).
- ESLint extends `eslint:recommended` and `plugin:react/recommended`; keep code compliant.
- Follow existing module/file naming patterns in each folder (e.g., React components in `src/components/`).

## Testing Guidelines
- No dedicated unit test runner is configured; rely on linting plus manual extension testing.
- For manual checks, load the unpacked extension from `build/chromium/` or `build/firefox/` after a build.
- If you add tests, document how to run them in this file.

## Commit & Pull Request Guidelines
- Commit messages in history favor short, imperative summaries (e.g., `fix: ...`, `Bump version ...`, `Revert "..."`).
- Keep commits focused and scoped to one change.
- PRs should include a brief summary, testing notes (commands or manual steps), and screenshots for UI changes.

## Configuration & Localization Notes
- Search engine and rules configuration lives under `src/config/` and `src/rules.json`; validate changes with `npm run verify`.
- Keep user-facing strings in `_locales/` to avoid hard-coded text in UI components.
