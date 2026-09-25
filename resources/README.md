# ChatGPT Web protocol reference

These files are user-provided or browser-observed official ChatGPT Web production
bundles retained as a protocol reference for the local gateway.

**`chatgpt-web/current/` is the three-bundle reference for the legacy frontend.**
The protocol probe reads that folder (via `npm test` / `npm run build`) and
maps each bundle to a role by protocol markers. Do not hardcode replacement
filenames in `src/`.

| Directory | Meaning |
| --- | --- |
| `chatgpt-web/current/` | Live reference. Whatever `.js` files are here are the current three. |
| `chatgpt-web/current/routes/` | Supplemental route entry points; not protocol bundles and not scanned by the probe. |
| `chatgpt-web/archive/` | Previous bundles you want to keep. The probe ignores this folder. |
| `chatgpt-web/catalogs/` | Official `/models` JSON snapshots for tests. Use Windows-safe names only (no `:` or `?`). |
| `chatgpt-web/integrity/` | Explicit native-page export contracts and supplemental official runtime snapshots, independently verified for the integrity bridge. |
| `chatgpt-web/codex-webview/` | Credential-free manifest of the 2026-09-25 Rspack frontend. Kept alongside the legacy probe because both frontends may be served. |

## When ChatGPT ships new hashes

1. Move the old files from `current/` into `archive/`.
2. Drop the new `.js` bundles into `current/`.
3. Run `npm run sync-protocol-reference` (or `npm run build`). That writes
   `src/services/protocol-probe/chatgpt-web-current.mjs` from the folder.
   `npm test` does not regenerate it — if the map is stale, tests fail.

If a dropped file cannot be identified, or `current/` has extras that are not
one of the three roles, sync fails instead of guessing.

The active set is the supplied **2026-09-23** snapshot. Its delta decoder and
resume controller moved from `conversation-small` to `4813494d`; marker checks
now reflect that move. The three `_conversation*` files are route entry points,
retained in `current/routes/`. The former current set is preserved in `archive/`.
See the [Chinese comparison and adaptation notes](../docs/chatgpt-web-2026-09-23.md).

The integrity bridge also supports the runtime observed in a fresh proxy tab on
2026-09-24. Its public source was saved from
`https://chatgpt.com/cdn/assets/4813494d-ntf51ax9e0u08606.js` to `integrity/`;
SHA-256: `45e2a6ef9f75cc56e2ed9872afa628b82e6fe985cf96111a4be24c0793926ab0`.
Its native auth-header export is `Ctt`, while the 2026-09-23 reference uses `vtt`.
`integrity/runtime-contracts.json` binds each checked filename to its exact exports.
Do not assume minified exports have the same meaning after a filename change.

The 2026-09-25 frontend uses a different module system and native browser
transport. Its contract is additive; do not put its chunks into the legacy
three-role probe. See [the new compatibility and initialization notes](../docs/chatgpt-web-2026-09-25.md).

Decoded protocol, grep pointers, and the gateway implementation boundary are in
[`docs/chatgpt-web-stream-resume.md`](../docs/chatgpt-web-stream-resume.md).
Search `resources/chatgpt-web/current/*.js` — do not rely on a specific hash in
the path.

Credential review: no request-specific bearer token, account ID, cookie value,
conduit token, session ID, proof token, or Turnstile token was intentionally
included.

The bundles are excluded from formatting and linting so they stay identical to
the provided reference, with one exception: `conversation-small` contained a
Mapbox-*format* telemetry token (`pk.eyJ…`, payload `{"u":"oai-data",…}`) that
GitHub push protection classifies as a secret. It was replaced with
`REDACTED_MAPBOX_FORMAT_TOKEN`; it is public browser-served telemetry metadata,
not a credential, and is unrelated to the protocol under study. Upstream
redistribution and licensing status has not been established.
