# Build Profiles

The chatGPTBox build (`build.mjs`) produces different bundles depending on
which features are compiled in. The split exists because the Agent runtime
(assistants, ZIP-imported skills, MCP toolkits) is **experimental**: it is
excluded from the default release builds to keep the shipped bundle lean and
the runtime surface stable.

## Profiles

| Profile | Build command | `__CHATGPTBOX_ENABLE_AGENTS__` | Agent runtime |
|---|---|---|---|
| **core** (default) | `npm run dev` / `npm run build` | `false` | Replaced with no-op stubs (`src/stubs/*.stub.mjs`). |
| **agents** (experimental) | `npm run dev:agents` / `npm run build:agents` | `true` | Full agent runtime compiled in. |

The profile is selected by passing `--enable-agents` / `--agents` to
`build.mjs` (or setting `CHATGPTBOX_ENABLE_AGENTS=true`). See `build.mjs:17`.

## What the flag controls

When `enableAgents` is **false** (core profile):

- Five modules are swapped for no-op stubs at compile time via
  `replaceModuleWhenAgentsDisabled` in `build.mjs`:
  - `services/agent-context.mjs` → `src/stubs/agent-context.stub.mjs`
  - `services/mcp/tool-loop.mjs` → `src/stubs/mcp-tool-loop.stub.mjs`
  - `services/agent/session-state.mjs` → `src/stubs/session-state.stub.mjs`
  - `services/skills/importer.mjs` → `src/stubs/skills-importer.stub.mjs`
  - `popup/components/AgentsTab.jsx` → `src/stubs/agents-tab.stub.jsx`
- `ENABLE_AGENT_FEATURES` (`src/config/constants.mjs`) is `false`, so built-in
  assistants, skills, and MCP server ids are empty strings, and
  `defaultConfig.enableSkills` defaults to `false`.
- The Agents tab is hidden from the settings UI.

When `enableAgents` is **true** (agents profile), the real modules are kept,
`ENABLE_AGENT_FEATURES` is `true`, and the Agents tab is shown. Agent features
still require `enableSkills` to be turned on in the extension settings at
runtime.

## Stub contract

The stubs must expose the same export names as the modules they shadow, or
production builds silently import `undefined`. This is enforced by
`tests/feature-flag-contract.test.mjs`. Any new export added to a real agent
module must be mirrored in its stub or that test fails.

## Release policy

Release packages published to GitHub Releases are **core** builds unless the
release notes say otherwise. To ship an agents-profile release, the maintainer
must run `npm run build:agents` and note the profile in the release notes.
