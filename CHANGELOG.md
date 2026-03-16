# Changelog

## v3.2.0 - 2026-03-16

- Added cached ChatGPT conversation APIs to the local API Server Bridge, including list, detail, create, follow-up message, and refresh endpoints.
- Added local conversation caching plus draft workflow scripts for inspecting threads and sending queued follow-ups through the gateway.
- Redesigned the settings experience around quick settings and clearer top-level tabs for General, Features, Agents, Modules, and Advanced configuration.
- Improved gateway and Brave compatibility with reverse-port messaging, connection health handling, buffered websocket events, and safer settings-page behavior.
- Updated model handling so ChatGPT Web conversation requests preserve upstream slugs and work with the newer dynamic model list flow.
- Expanded the API server documentation with exact endpoint behavior, cache semantics, and request/response examples.
