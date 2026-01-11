# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds all extension source code (background scripts, content scripts, popup UI, pages, components, services, and utilities).
- `src/manifest.json` and `src/manifest.v2.json` define extension permissions and entry points; `src/_locales/` stores i18n strings.
- `src/rules.json`, `src/fonts/`, and `src/logo.png` are packaged assets.
- `build/` is generated output (e.g., `build/chromium` and `build/firefox`).
- `safari/` contains Safari packaging scripts; `screenshots/` contains store assets.
- `build.mjs` is the main build pipeline.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run dev`: development build to `build/` for local extension loading.
- `npm run build`: production build.
- `npm run analyze`: bundle analysis.
- `npm run build:safari`: Safari packaging (`safari/build.sh`).
- `npm run lint` / `npm run lint:fix`: lint the codebase with ESLint.
- `npm run pretty`: format JS/JSX/JSON/CSS/SCSS with Prettier.
- `npm run verify`: validate search engine configs via `.github/workflows/scripts/verify-search-engine-configs.mjs`.

## Coding Style & Naming Conventions
- Prettier is authoritative: 2-space indentation, no semicolons, single quotes, trailing commas, print width 100.
- ESLint uses `eslint:recommended` and `plugin:react/recommended` (React-in-JSX-scope disabled for Preact).
- File extensions: `.jsx` for UI components/pages, `.mjs` for modules and utilities.
- Utility filenames follow kebab-case (e.g., `src/utils/parse-float-with-clamp.mjs`); component folders use `PascalCase` component names inside (`index.jsx`, `Component.jsx`).

## Testing Guidelines
- No dedicated unit test suite is present; rely on `npm run lint`, `npm run pretty`, and `npm run verify`.
- Manual validation: load `build/chromium` or `build/firefox` as an unpacked extension and smoke-test popup/content script flows.

## Commit & Pull Request Guidelines
- Recent commits use Conventional Commit prefixes (`feat:`, `fix:`) plus occasional `Revert` and `Bump version` messages. Prefer concise, imperative subjects and use `feat:`/`fix:` when applicable.
- PRs should include: a summary, testing notes (commands and browsers), linked issues, and screenshots or screen recordings for UI changes.

## Agent-Specific Notes
- Automation instructions for AI agents live in `CLAUDE.md`. Follow them only when running those specific workflows.
