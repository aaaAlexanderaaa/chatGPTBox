# ChatGPT Web protocol reference

`8b34dbc2-kcpqu5058w4p0qpa.js` is a user-provided, unmodified ChatGPT Web production
bundle retained as a protocol reference for the local gateway implementation.

- Added: 2026-08-13
- SHA-256: `e79414f74728b7ddd7c02c24fc102bf03f9f6ec6132ce62bc06608dde71c2872`
- Relevant behavior: `/backend-api/f/conversation/resume`, `offset`-based resume retries,
  `resume_conversation_token`, `stream_handoff`, and `subscribe_ws_topic`
- Credential review: no request-specific bearer token, account ID, cookie value, conduit token,
  session ID, proof token, or Turnstile token was intentionally included

The bundle is excluded from formatting and linting so it remains byte-for-byte identical to the
provided reference. Its upstream redistribution and licensing status has not been established.
