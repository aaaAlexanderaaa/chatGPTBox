# Enhancement Architecture and Task Deliverables

Date: 2026-02-06
Scope: Add assistant/skills/MCP support without breaking legacy behavior.

> Note (2026-02-10): The skill model in this document is superseded by imported ZIP skill packs.
> See `docs/agents-runtime-v2.md` for the current architecture.

## 1. CompatibilityContract (T001-T004)

### T001: Non-breaking invariants
The runtime preserves the following invariants when no assistant/skills/MCP are selected:
1. Existing chat request flow remains unchanged for all provider adapters.
2. Existing selection tools remain available and unchanged.
3. Existing site adapter activation and matching logic remains unchanged.
4. Existing popup settings and shortcuts remain unchanged.
5. Existing session rendering and persistence remains readable by pre-enhancement logic.

### T002: Compatibility gate matrix
Legacy path is selected when all conditions are true:
- `session.assistantId` is null/empty.
- `session.systemPromptOverride` is empty.
- `session.selectedSkillIds` is null or empty.
- `session.selectedMcpServerIds` is null or empty.
- No enabled assistant default injects context for the current session.

Enhanced path is selected when any of the above is not true.

### T003: Regression baseline scenarios
Regression baseline includes:
- Create/edit/delete session.
- Ask question in each currently supported provider group.
- Selection tool invoke flow.
- Site adapter rendering across supported search engines.
- Popup settings save/load and persistence.
- Context extraction behavior.

### T004: Legacy unchanged acceptance criteria
Pass criteria:
1. No new runtime errors on legacy-only sessions.
2. Message payload structure matches pre-enhancement behavior when gate is legacy.
3. Session history remains readable and writable.
4. Default settings preserve old behavior (opt-in enhancement model).

## 2. PlatformConfig (T005-T008)

### T005: Optional config v2 additions
`src/config/index.mjs` defines additive optional fields:
- `configVersion`, `runtimeMode`.
- `assistants`, `defaultAssistantId`.
- `skills`, `defaultSkillIds`.
- `mcpServers`, `defaultMcpServerIds`.

### T006: Migration rules
Migration semantics in `getUserConfig()`:
- Missing fields receive safe defaults.
- Invalid IDs are dropped from default selections.
- Corrupt entries are normalized or removed.
- Existing legacy fields remain intact.

### T007: Validation and safe defaults
Implemented in `src/config/index.mjs` and `src/services/local-session.mjs`:
- Numeric clamping for token/context/temperature values.
- Runtime mode validation.
- Object normalization for assistants/skills/MCP.
- Session shape repair for new additive fields.

### T008: Feature flag strategy
Feature flags are rollout controls (documented policy):
- Default state: enhancement behavior opt-in.
- Enablement levels: schema-only -> UI-visible -> runtime-active.
- Rollback: disabling enhancement flags restores legacy gate behavior.

## 3. AssistantProfile (T009-T012)

### T009: Assistant schema
Assistant object:
- `id`, `name`, `systemPrompt`, `defaultSkillIds`, `defaultMcpServerIds`, `active`.

### T010: Assistant CRUD lifecycle
CRUD semantics are implemented in settings UI and persisted config:
- Create/edit/delete in popup modules.
- Persist via `updateConfig()`.
- Deterministic identity via generated `id`.

### T011: Default resolution
Resolution chain:
1. Session explicit `assistantId`.
2. Global `defaultAssistantId`.
3. No assistant.

### T012: Missing reference compatibility
Missing skill/server references are handled by normalization and filtering:
- Invalid IDs are dropped from defaults.
- Session resolution filters to active/valid objects only.

## 4. RuntimeSelection (T013-T014)

### T013: Session selection model
Session model includes:
- `assistantId`, `systemPromptOverride`, `selectedSkillIds`, `selectedMcpServerIds`, `toolEvents`.

### T014: Selection precedence
Precedence order:
1. Session override values.
2. Selected assistant defaults.
3. Global defaults.
4. Empty fallback.

## 5. PromptComposer (T015-T017)

### T015: Prompt composition pipeline
`src/services/agent-context.mjs` composes runtime context in this order:
1. Session system override.
2. Assistant system prompt.
3. Declarative skill directives.
4. Script skill descriptors.
5. Selected MCP endpoint context hints.

### T016: Provider adaptation rules
Provider adaptation implemented by API adapters:
- OpenAI/compatible chat APIs: system role injection via conversation pairs.
- Completion APIs: system text prefix in completion prompt.
- Claude API: `system` field populated explicitly.
- Reasoning model edge case: fallback user-message composition preserves system instructions when system role is restricted (`src/services/apis/openai-api.mjs`).

### T017: Context budgeting and truncation strategy
Budget strategy:
- Continue using existing context window trimming (`maxConversationContextLength`).
- Apply composed system context once per request.
- When prompt pressure is high, keep explicit user request and most recent turns first.

## 6. SkillCatalog (T018-T020)

### T018: Unified skill schema
Skill object:
- `id`, `name`, `type` (`declarative`|`script`), `prompt`, `script`, `trustTag`, `active`.

### T019: Legacy tool migration mapping
Mapping policy:
- Existing `customSelectionTools` map to declarative skills.
- Existing menu-tool semantics remain available; no destructive migration.
- Coexistence model: skill catalog is additive.

### T020: Capability manifest fields
Capability manifest model:
- `inputType`, `outputType`, `requiresNetwork`, `requiresNativeHost`, `writesSession`, `riskLevel`.
- Default capability set inferred by skill type and trust tag.

## 7. SkillExecutor (T021-T023)

### T021: Declarative execution contract
Declarative execution:
- Input: user text.
- Transform: prompt template interpolation (`{{input}}`).
- Output: instruction text appended to context.

### T022: Script sandbox model
Script execution policy:
- Script skills are disabled unless policy allows.
- `safe` mode permits only `trusted` scripts.
- `developer` mode permits script execution for active script skills.

### T023: Timeout/cancellation/retry semantics
Execution controls:
- Skill execution should be bounded by timeout.
- Failed skill should not abort base chat flow; continue with degraded context.
- Retry policy applies only to transient execution errors.

## 8. PolicyEngine (T024-T026)

### T024: Safe mode capability matrix
Safe mode defaults:
- Deny native host access unless explicitly selected and approved.
- Deny non-trusted script execution.
- Allow declarative prompt skills.

### T025: Developer mode unlock flow
Developer mode requirements:
- Explicit user selection in settings.
- Clear risk text and reversible setting.
- Session-level behavior remains auditable.

### T026: Approval UX contract
Approval contract fields:
- `actionType`, `resource`, `riskLevel`, `requestedAt`, `decision`, `decidedAt`.
- Trigger conditions: risky skill execution and external MCP operations.

## 9. TrustModel (T027-T028)

### T027: Trust tag behavior
Trust behavior:
- `normal`: conservative execution.
- `trusted`: allowed in safe mode where policy permits.
- `developer` mode can widen allowed operations with explicit user responsibility.

### T028: Trust audit trail
Audit trail events:
- Tool call requested/started/completed/failed.
- Approval requested/approved/rejected.
- Runtime mode at execution time.

## 10. McpCatalog (T029-T030)

### T029: MCP schema
MCP server object:
- `id`, `name`, `transport` (`http`|`stdio`), `httpUrl`, `apiKey`, `nativeHostName`, `stdioCommand`, `stdioArgs`, `active`.

### T030: API key handling
Policy:
- Keys stored in extension local storage with masked display in UI.
- Updates overwrite previous key without exposing plaintext in list views.

## 11. McpTransportLayer (T031-T032)

### T031: HTTP contract
Implemented in `src/services/mcp/http-transport.mjs`:
- JSON-RPC envelope.
- Timeout handling.
- Retry/backoff for transient failures.
- JSON and SSE/event-stream response parsing.
- Convenience client wrapper (`createMcpHttpClient`).

### T032: stdio/native abstraction
Implemented in `src/services/mcp/stdio-native-transport.mjs`:
- Host resolution from config (`nativeHostName`).
- Port connect/disconnect lifecycle.
- Timeout + retry for request/response.
- JSON-RPC send/list/call wrappers (`createNativeMcpClient`).

## 12. NativeHostBridge (T033-T035)

### T033: Native host protocol envelope
Protocol envelope:
- Request: `{jsonrpc,id,method,params}`.
- Response: `{jsonrpc,id,result|error}`.
- Error object includes `code`, `message`, optional `data`.

### T034: Installer workflow
Local dev installer workflow:
1. Build extension bundle.
2. Build/register native host manifest for Chromium/Brave.
3. Load unpacked extension.
4. Validate native messaging handshake.

### T035: Build outputs
Expected outputs:
- Browser extension unpacked build.
- Extension zip archive.
- Native host bundle and registration notes.

## 13. ToolOrchestrator (T036-T038)

### T036: Tool routing algorithm
Routing order:
1. Declarative skills for context shaping.
2. Script skills (policy permitting).
3. MCP server tools when request requires external capabilities.

### T037: Lifecycle events and retry logic
Lifecycle states:
- `queued`, `started`, `waiting_approval`, `running`, `succeeded`, `failed`, `cancelled`.
- Retries only for transient transport/runtime failures.

### T038: Provider adapter interface
Adapter contract:
- `buildPrompt(session, config, question)`
- `sendRequest(payload)`
- `parseStream(chunk)`
- `finalizeResponse()`

## 14. SessionEventLog (T039-T040)

### T039: Additive event schema
Event schema extends sessions with `toolEvents[]` and event metadata fields.

### T040: Serialization and replay
Replay model:
- Legacy sessions without `toolEvents` deserialize with empty array.
- Enhanced sessions replay events without affecting legacy render behavior.

## 15. ControlPlaneUI (T041-T043)

### T041: Minimal selector UX
Implemented in conversation UI:
- Assistant selector.
- Skill/MCP per-session toggles.
- Optional system prompt override.

### T042: Settings IA for assistants/skills/MCP
Implemented in popup Modules tab:
- Assistants management section.
- Skills catalog section.
- MCP server section.

### T043: Trace and approval interaction
Design contract:
- Trace panel event rows mirror lifecycle states.
- Approval prompts surface risk + target resource + action.

## 16. BuildDistribution (T044-T045)

### T044: `npm run build` artifact layout contract
Build contract:
- Keep current extension output structure.
- Include enhancement assets without changing load path assumptions.

### T045: Local install and update runbook
Runbook contract:
- Build extension.
- Load unpacked extension in Chromium/Brave.
- Register/update native host manifest.
- Verify runtime integration.

## 17. QualityGate (T046-T048)

### T046: Test matrix
Test matrix includes:
- Config migration tests.
- Prompt composition tests.
- Skill policy tests.
- MCP transport tests.
- Legacy regression tests.

### T047: CI gate updates
CI policy target:
- Lint + build + config verification + new enhancement checks.
- Fail release if compatibility gate tests fail.

### T048: Mandatory review workflow
Review workflow codified in `plan.md` and enforced in task bookkeeping:
- Complete -> review -> pass/fail -> reopen with follow-up tasks if failed.

## 18. Follow-up Fix Closure (T049-T053)

### T049 (for T015)
Prompt-composition contract refined and documented in this file and `src/services/agent-context.mjs`.

### T050 (for T016)
Provider adaptation edge case fixed in `src/services/apis/openai-api.mjs` for reasoning models.

### T051 (for T031)
HTTP MCP transport hardened with timeout/retry/stream parsing in `src/services/mcp/http-transport.mjs`.

### T052 (for T032)
Native stdio abstraction finalized with resilient client lifecycle in `src/services/mcp/stdio-native-transport.mjs`.

### T053 (for T041)
Control-plane selector behavior and low-disruption UX contract finalized in this document and existing UI sections.

## 19. Deliverable Index
Key implementation files:
- `src/config/index.mjs`
- `src/services/local-session.mjs`
- `src/services/init-session.mjs`
- `src/services/agent-context.mjs`
- `src/services/apis/openai-api.mjs`
- `src/services/apis/custom-api.mjs`
- `src/services/apis/azure-openai-api.mjs`
- `src/services/apis/claude-api.mjs`
- `src/services/mcp/http-transport.mjs`
- `src/services/mcp/stdio-native-transport.mjs`
- `src/popup/components/GeneralTab.jsx`
- `src/popup/components/ModulesTab.jsx`
- `src/popup/sections/Assistants.jsx`
- `src/popup/sections/SkillsCatalog.jsx`
- `src/popup/sections/McpServers.jsx`
- `src/components/ConversationCard/index.jsx`
- `src/utils/get-conversation-pairs.mjs`
