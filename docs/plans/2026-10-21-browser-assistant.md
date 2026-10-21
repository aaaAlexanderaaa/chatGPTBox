# Browser assistant: first usable delivery

Status: implemented in `codex/browser-assistant`, 2026-10-21.

The approved product direction is `docs/product/browser-assistant.md`. Start from
the current page, make the material being sent visible, and let users keep and
change a useful way of working. The earlier engineering exploration is reference
material rather than a required architecture.

This delivery connects page, selection, and editable-input actions to the existing
provider transport. It includes reusable functions with an explicit input scope,
prompt, optional engine, and result presentation; reading annotations with exact
source checks; and editable-text previews that refuse stale replacements.

The settings Tools page manages saved functions, including presets, editing,
duplication, and portable import/export. A page action can also start from a
one-off instruction and save it for reuse. Existing selection tools retain their
behavior and configuration.

Validation covers input isolation, configuration validation and persistence,
engine precedence, exact source anchoring, stale input protection, UI interaction,
lint, and extension production builds. Live provider checks require the user's
configured credentials; local browser checks use a deterministic test provider.

External tool loops and persistent task orchestration will need their own real
use cases and interfaces. Translation-specific development remains deferred.

## Verification

- `npm run lint`: passed.
- `npm test`: 109 files and 1356 tests passed, including 32 new assistant tests.
- `npm run build`: Chromium, Firefox, and both reduced-size bundles produced.
- Playwright: source highlighting and navigation, rewrite application and undo,
  saved functions appearing in the library, Chinese interface, light/dark themes,
  and 375px layout without horizontal overflow checked with real components.

The browser checks used an isolated profile and a deterministic local test
transport. Live account authentication, remote model quality, and website-specific
editor compatibility were not verified. Usage and supported file format are in
[`docs/browser-assistant.md`](../browser-assistant.md).
