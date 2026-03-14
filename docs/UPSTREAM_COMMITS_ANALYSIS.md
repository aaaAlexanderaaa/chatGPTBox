# Upstream Commits Analysis (Revised)

**Date:** February 27, 2026  
**Upstream:** https://github.com/josstorer/ChatGPTBox  
**Common ancestor:** `7b99ec5`  
**Commits analyzed:** 27 commits in `upstream/master` not in this branch

---

## 1. Methodology and Scope

### 1.1 Analytical Framework

For each upstream commit, this analysis applies:

1. **File mapping**: Which files does the commit touch? Does this repo have equivalent files?
2. **Code-path verification**: Does this repo have the same code paths the commit modifies?
3. **Design alignment**: Does this repo share the same design assumptions (e.g., message handlers, API structure)?
4. **Evidence chain**: Each applicability conclusion is tied to specific file paths and line references.

### 1.2 Repository Divergence (Evidence)

**Files changed since common ancestor:**

| Source | Files changed | Notable differences |
|--------|---------------|---------------------|
| **This repo** | ~80+ files | Added: `src/agent/`, `src/services/mcp/`, `src/pages/ApiServer/`, `src/services/agent-context.mjs`, MCP tool-loop, agent protocols, different popup structure |
| **Upstream** | ~31 files | Added: `tests/`, `openai-token-params.mjs`; modified: `build.mjs`, `pr-tests.yml`, `src/background/index.mjs`, `src/config/index.mjs` |

**Structural differences:**

- **This repo** has `src/services/mcp/tool-loop.mjs` (MCP integration); upstream does not.
- **This repo** has `src/agent/` (protocols, session-state); upstream does not.
- **This repo** uses `executeApi` with `detectExecutionRoute`; upstream uses a different flow with `redactSensitiveFields`.
- **Upstream** has `tests/` and `openai-token-params.mjs`; this repo does not.
- **Config**: Both have `src/config/index.mjs` but model keys and structure differ.

---

## 2. Commit-by-Commit Analysis with Evidence

### 2.1 GPT-5 Token Parameter Fix (`aabd810`)

**Upstream change:** Introduces `openai-token-params.mjs` and `getChatCompletionsTokenParams(provider, model, maxResponseTokenLength)`. Uses `max_completion_tokens` for OpenAI GPT-5-family chat models; `max_tokens` otherwise.

**Files touched:** `custom-api.mjs`, `openai-api.mjs`, `openai-token-params.mjs` (new)

**This repo evidence:**

- `src/services/apis/openai-api.mjs` lines 243–265: Uses `max_completion_tokens` only when `isReasoningModel` is true. Non-reasoning models use `max_tokens` (line 263).
- `src/utils/model-name-convert.mjs` lines 205–209: `isUsingReasoningModel` excludes `gpt-5-chat-*` (e.g. `gpt-5-chat-latest`, `gpt-5.1-chat-latest`).
- Therefore: GPT-5 chat models follow the non-reasoning path and receive `max_tokens`, which can trigger the OpenAI error.

**Applicability:** **Yes.** This repo has GPT-5 chat models in config and uses `max_tokens` for them. The fix is applicable.

---

### 2.2 GET_COOKIE Sender Authorization (`69739bd`)

**Upstream change:** Rejects `GET_COOKIE` when `sender.id !== Browser.runtime.id`.

**This repo evidence:**

- `src/background/index.mjs` lines 401–403: `if (sender?.id && sender.id !== Browser.runtime.id) return null`

**Applicability:** **Already implemented.** No change needed.

---

### 2.3 GET_COOKIE Payload Validation (`304c612`)

**Upstream change:** Validates `url` and `name` as non-empty strings, parses URL, trims inputs.

**This repo evidence:**

- `src/background/index.mjs` lines 404–416: Validates `typeof url === 'string'` and `typeof name === 'string'`, uses `new URL(url)`, and enforces `allowedCookieNamesByOrigin` (whitelist).
- Design difference: This repo uses a whitelist (`allowedCookieNamesByOrigin`); upstream is more permissive.
- Missing: No explicit `trim()` or empty-string check before `new URL(url)`.

**Applicability:** **Partial.** Adding `trim()` and empty-string checks would improve robustness without changing the whitelist design.

---

### 2.4 Cookie Protocol and Header Validation (`239aa4d`)

**Upstream change:** (a) Validates FETCH URL with `new URL()` and restricts to http(s); (b) Validates GET_COOKIE URL protocol; (c) Guards header iteration; (d) Avoids logging full header values.

**This repo evidence:**

- **FETCH** (`src/background/index.mjs` lines 372–399): Uses `message.data.input` directly in `fetch()` with no URL validation. **Vulnerable to non-http(s) or malformed URLs.**
- **GET_COOKIE** (lines 409–410): Already restricts to `https:` only.
- **Header modification:** This repo uses `declarativeNetRequest` (rules) and `getScopedHeaderRewriteRules`; upstream uses `webRequest` with `requestHeaders` iteration. Different mechanisms.

**Applicability:** **FETCH: Yes.** URL validation before `fetch()` is missing and should be added. **GET_COOKIE:** Already protocol-restricted. **Headers:** Different implementation; review only if similar iteration exists.

---

### 2.5 Guard Custom API Mode Overrides (`e2108a6`)

**Upstream change:** Uses `session.apiMode.customUrl?.trim()` and `session.apiMode.apiKey?.trim()`.

**This repo evidence:**

- `src/background/index.mjs` lines 181–184: `session.apiMode.customUrl.trim()` and `session.apiMode.apiKey.trim()` — no optional chaining.
- Context: `if (!session.apiMode)` guards the block, but `customUrl` or `apiKey` can be `undefined` when `session.apiMode` exists.

**Applicability:** **Yes.** Optional chaining prevents crashes when properties are missing.

---

### 2.6 Make Static Card Init Non-Blocking (`04208f1`)

**Upstream change:** Replaces `await prepareForStaticCard()` with `prepareForStaticCard().catch(...)`.

**This repo evidence:**

- `src/content-script/index.jsx` lines 582–586: `prepareForStaticCard()` is called without `await` (fire-and-forget). **Already non-blocking.**
- No `.catch()` on the promise.

**Applicability:** **Partial.** Only improvement is adding `.catch()` for error logging.

---

### 2.7 Guard Proxy Message Forwarding (`090044e`)

**Upstream change:** Checks `port._isClosed` before forwarding; wraps `port.postMessage(msg)` in try/catch.

**This repo evidence:**

- `src/background/index.mjs` lines 115–140: `setPortProxy` is simpler — no `_isClosed`, no reconnect logic.

**Upstream design:** `_isClosed` is set in the larger reconnect/error-handling refactor (`1bd2a93`). `090044e` alone is not self-contained.

**Applicability:** **Conditional.** Would require adopting the reconnect/error-handling design from `1bd2a93` to use `_isClosed` and related guards. Otherwise, a try/catch around `postMessage` is a low-risk improvement.

---

### 2.8 Improve Background Script Error Handling (`1bd2a93`)

**Upstream change:** Large refactor: reconnect logic with exponential backoff, sensitive field redaction, listener cleanup.

**This repo evidence:**

- `src/background/index.mjs` lines 115–140: `setPortProxy` is ~25 lines; no reconnect, no redaction.

**Applicability:** **Architectural.** Adoption would require significant refactoring. Use as a reference for patterns (redaction, reconnect) rather than a direct patch.

---

### 2.9 Model Updates (`3832a3d`, `2a81de9`, `9746218`, `718a985`, `5c12582`, `c435016`)

**Upstream change:** Add/remove model entries in config.

**This repo evidence:**

- `src/config/index.mjs`: Different model key structure and `modelKeys` layout. Model keys and mappings differ from upstream.

**Applicability:** **Reference only.** Use upstream as a reference for which models to add/remove; adapt to this repo’s config structure.

---

### 2.10 Node Unit Tests (`f9ef899`, `9ed7fa8`, `ab628e1`)

**Upstream change:** Adds `tests/setup/browser-shim.mjs`, `npm test` script, and unit tests.

**This repo evidence:**

- No `tests/` directory. No `npm test` in `package.json`. Scripts include `test:agent` but no Node unit tests.

**Applicability:** **Yes.** Adopting would add test infrastructure and a baseline.

---

### 2.11 Run npm Tests in CI (`a410842`)

**Upstream change:** Adds `npm test` to the pr-tests workflow.

**Applicability:** **Depends on 2.10.** Relevant once Node tests exist.

---

### 2.12 Build Pipeline, Dependencies, Other

- **Build refactor** (`11b4531`, `727b578`, `9537643`): Different build setup; optional.
- **Dependency bumps** (actions, jws): Low priority.
- **npm audit fix** (`055d6b4`): Run `npm audit` and apply fixes with review.
- **Content script stability** (`0dbe283`): Review diff if similar issues arise.

---

## 3. Corrections to Prior Analysis

| Prior claim | Correction |
|-------------|------------|
| "Add sender check if not already equivalent" for GET_COOKIE | Sender check is already present. |
| "Guard proxy message forwarding" as a standalone adoption | Depends on `_isClosed` and reconnect logic from `1bd2a93`. |
| "Make static card init non-blocking" as a main change | Init is already non-blocking; only `.catch()` is missing. |
| Generic "validate GET_COOKIE payload" | This repo uses a whitelist; validation improvements are partial (trim, empty-string checks). |
| "Validate FETCH URL" without evidence | Confirmed: FETCH handler uses `message.data.input` without validation. |

---

## 4. Evidence-Based Recommendations

| Priority | Commit / area | Evidence | Action |
|----------|---------------|----------|--------|
| High | `aabd810` (token params) | openai-api.mjs uses `max_tokens` for non-reasoning models; GPT-5 chat is non-reasoning | Add `openai-token-params.mjs` and use in openai-api, custom-api, tool-loop |
| High | `e2108a6` (api mode guard) | Lines 181–184 use `.trim()` without optional chaining | Use `?.trim()` for `customUrl` and `apiKey` |
| High | `239aa4d` (FETCH URL) | FETCH uses `message.data.input` unvalidated | Validate URL and restrict to http(s) before `fetch()` |
| Medium | `304c612` (GET_COOKIE payload) | No trim or empty-string check | Add trim and empty-string validation |
| Medium | `04208f1` (static card) | No `.catch()` on `prepareForStaticCard()` | Add `.catch()` for error logging |
| Medium | `090044e` (proxy guard) | No try/catch around `postMessage` | Add try/catch around `port.postMessage` (minimal change) |
| Reference | Model updates | Config structure differs | Use upstream as reference for model list changes |
| Reference | Tests | No tests directory | Add tests and `npm test` when feasible |

---

## 5. Files to Inspect in Upstream

For implementation details:

- `src/services/apis/openai-token-params.mjs` — token parameter logic
- `src/services/apis/openai-token-params.test.mjs` — unit tests
- `src/background/index.mjs` — FETCH validation, optional chaining
- `tests/setup/browser-shim.mjs` — Node test setup
