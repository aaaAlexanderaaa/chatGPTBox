# Agents Runtime v2 (Imported Skills + MCP HTTP Loop)

Date: 2026-02-10

## Overview

This version removes inline prompt/script "skills" and replaces them with imported ZIP skill packs.
Skills are discovered from `SKILL.md` files inside ZIP archives and stored as normalized installed-skill metadata in extension config.

## Skill model

- `installedSkills[]` is the only skill catalog.
- Each skill is imported from `.zip` and must include `SKILL.md`.
- Parsed fields:
  - `id`, `name`, `description`, `version`
  - `sourceName`, `sourceHash`
  - `entryPath`, `instructions`
  - `resources[]` (linked local files extracted from package)
  - `active`, `importedAt`
- Legacy inline fields (`type`, `prompt`, `script`, `trustTag`) are removed from runtime behavior.

## UI model

- New top-level `Agents` page in popup.
- `Agents` page includes:
  - Assistants manager
  - Skills installer/list (ZIP import only)
  - MCP servers manager
- `Modules` keeps non-agent modules: API modes, selection tools, sites, extractor.

## MCP model

- HTTP transport only in UI/runtime policy for this phase.
- Selected MCP servers are used by an OpenAI-compatible tool loop:
  1. Discover tools via `tools/list`
  2. Send model request with tool schema
  3. Execute `tools/call` when model requests tool calls
  4. Append tool results and continue loop until final answer or max turns
- Tool events are appended to `session.toolEvents` for traceability.

## Notes

- Selection tools are unchanged and remain a separate published feature.
- stdio/native MCP transport code may still exist in repository, but the v2 UI/runtime path uses HTTP streaming MCP only.
