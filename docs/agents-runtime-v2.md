# Agents Runtime (Current Implementation Snapshot)

Date: 2026-03-11

## Overview

This document describes the runtime that is currently implemented in the extension, not the original rollout plan.

The agent stack is additive:

- regular chat flows still exist
- legacy selection tools still exist
- assistants / imported skills / MCP can be layered onto supported API-style runtimes

## Current configuration model

The main additive fields live in extension config:

- `runtimeMode`
- `agentProtocol`
- `assistants[]`
- `defaultAssistantId`
- `installedSkills[]`
- `defaultSkillIds[]`
- `mcpServers[]`
- `defaultMcpServerIds[]`

Built-in defaults are shipped from `src/config/index.mjs`:

- one built-in assistant: `Design Pattern Analyst`
- one built-in skill: `Analyze Current Web Design Patterns`
- built-in MCP entries such as `Skill Library (Built-in)` and `Browser Context Toolkit (Built-in)`

## Skills model

`installedSkills[]` is the agent-skill catalog used by the runtime.

- Imported skills come from `.zip` files and must contain `SKILL.md`.
- The importer extracts:
  - `id`, `name`, `description`, `version`
  - `sourceName`, `sourceHash`
  - `entryPath`, `instructions`
  - `resources[]` from linked local text files inside the ZIP
  - `active`, `importedAt`
- Built-in skills use the same normalized shape as imported skills.

Important distinction:

- `installedSkills[]` are agent/runtime skills.
- `customSelectionTools[]` are still the legacy selection-toolbar/context-menu tools.
- These systems coexist; imported skills do not replace selection tools.

## UI model

The popup settings UI now has top-level tabs:

- `General`
- `Features`
- `Agents`
- `Modules`
- `Advanced`

The `Agents` tab contains:

- assistant management
- ZIP skill import and activation
- MCP server management

The `Modules` tab keeps:

- API modes
- selection tools
- site adapters
- content extractors

## MCP model

The current UI/runtime supports two MCP categories:

- built-in MCP toolkits (`transport: "builtin"`)
- user-configured HTTP JSON-RPC endpoints with JSON or SSE/event-stream responses

Current runtime behavior:

1. list tools via `tools/list`
2. expose the tool schema to the selected model/runtime
3. execute `tools/call` when requested
4. append tool results and continue until an answer or step limit is reached

Tool execution is recorded in `session.toolEvents`.

## Runtime and protocol behavior

- `safe` runtime mode is the default.
- In `safe` mode, MCP HTTP endpoints are expected to use HTTPS.
- `developer` mode allows more permissive MCP/tool behavior.
- OpenAI-compatible runtimes can use `auto`, `openai_chat_completions_v1`, or `openai_responses_v1`.
- Anthropic tool calling is supported by the MCP loop even though the manual protocol selector in settings is focused on OpenAI-compatible runtimes.

## Current limitations

- Assistant / Skills / MCP are intended for API/custom runtime flows.
- ChatGPT Web models continue to work for chat, but they do not run the full assistant/skills/MCP context path.
- The current UI exposes built-in and HTTP MCP endpoints. Historical stdio/native transport artifacts may still exist in the repository, but they are not the main surfaced path.
