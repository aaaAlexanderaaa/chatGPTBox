# ChatGPT Web protocol reference

These files are user-provided ChatGPT Web production bundles retained as a protocol reference
for the local gateway. They are from one page load (2026-08-13).

| File | SHA-256 | Role |
| --- | --- | --- |
| `8b34dbc2-kcpqu5058w4p0qpa.js` | `e79414f74728b7ddd7c02c24fc102bf03f9f6ec6132ce62bc06608dde71c2872` | Conversation page orchestration (`kTt`, `MTt`, `CTt`, `xTt`) |
| `conversation-small-c1ziqs0jcp1f9pz2.js` | `cf1ae55587c51b4a65e2417a91011fb7617b2741610e09277ec3f46d9bd1e411` | SSE transport, delta v1, poll, conduit token store |
| `4813494d-k5qf4d34uhzjqhsa.js` | `08944b2c038545754d222be8d67def253870e9d5c9d52c680671e648365bd778` | WebSocket connection and topic offset |

Decoded protocol, grep pointers, and the gateway implementation boundary are in
[`docs/chatgpt-web-stream-resume.md`](../docs/chatgpt-web-stream-resume.md).

Credential review: no request-specific bearer token, account ID, cookie value, conduit token,
session ID, proof token, or Turnstile token was intentionally included.

The bundles are excluded from formatting and linting so they stay identical to the provided
reference, with one exception: `conversation-small` contained a Mapbox-*format* telemetry token
(`pk.eyJ…`, payload `{"u":"oai-data",…}`) that GitHub push protection classifies as a secret.
It was replaced with `REDACTED_MAPBOX_FORMAT_TOKEN`; it is public browser-served telemetry
metadata, not a credential, and is unrelated to the protocol under study. Upstream
redistribution and licensing status has not been established.
