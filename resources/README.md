# ChatGPT Web protocol reference

These files are user-provided ChatGPT Web production bundles retained as a
protocol reference for the local gateway.

**`chatgpt-web/current/` is the source of truth for the latest three files.**
The protocol probe reads that folder (via `npm test` / `npm run build`) and
maps each bundle to a role by protocol markers. Do not hardcode replacement
filenames in `src/`.

| Directory | Meaning |
| --- | --- |
| `chatgpt-web/current/` | Live reference. Whatever `.js` files are here are the current three. |
| `chatgpt-web/archive/` | Previous bundles you want to keep. The probe ignores this folder. |

## When ChatGPT ships new hashes

1. Move the old files from `current/` into `archive/`.
2. Drop the new `.js` bundles into `current/`.
3. Run `npm run sync-protocol-reference` (or `npm run build`). That writes
   `src/services/protocol-probe/chatgpt-web-current.mjs` from the folder.
   `npm test` does not regenerate it — if the map is stale, tests fail.

If a dropped file cannot be identified, or `current/` has extras that are not
one of the three roles, sync fails instead of guessing.

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
