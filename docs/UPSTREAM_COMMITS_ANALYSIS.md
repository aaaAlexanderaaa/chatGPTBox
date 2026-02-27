# Upstream Commits Analysis

**Date:** February 27, 2026  
**Upstream:** https://github.com/josstorer/ChatGPTBox  
**Commits analyzed:** 27 commits ahead of common ancestor

This document summarizes the upstream commits and identifies which ones are valuable for improving this repository. Since this fork has undergone significant changes (e.g., MCP, agent protocols, different config structure), direct merging is not practical. This analysis focuses on **insights and features worth learning from or adopting**.

---

## Summary: High-Value vs Low-Value

| Category | Count | Recommendation |
|----------|-------|----------------|
| **High value** (security, correctness, UX) | 8 | Adopt |
| **Medium value** (model updates, tests, CI) | 7 | Consider selectively |
| **Low value** (deps, build refactor) | 12 | Optional or N/A |

---

## High-Value Commits (Worth Adopting)

### 1. **GPT-5 Token Parameter Fix** (`aabd810`)
**Use:** `max_completion_tokens` for GPT-5-family Chat Completions and `max_tokens` for others.

**Why:** OpenAI GPT-5.1-family models return: `Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.`

**Current state:** This repo has `max_completion_tokens` for *reasoning* models (gpt-5-thinking) but not for GPT-5 *chat* models (e.g. `gpt-5-chat-latest`, `gpt-5.1-chat-latest`). Those would still hit the error.

**Adoption:** Add `openai-token-params.mjs` with `getChatCompletionsTokenParams(provider, model, maxResponseTokenLength)` and use it in `openai-api.mjs`, `custom-api.mjs`, and any MCP tool loop paths that call OpenAI-compatible APIs with GPT-5 chat models.

---

### 2. **Security: GET_COOKIE Sender Authorization** (`69739bd`)
**Use:** Reject `GET_COOKIE` messages from senders whose `sender.id !== Browser.runtime.id`.

**Why:** Prevents malicious extensions or pages from requesting cookies via the same message channel.

**Current state:** This repo has stricter checks (origin check, allowed cookie names by origin). The upstream check is simpler: only accept messages from the extension itself. **Recommendation:** Keep your stricter origin/cookie checks; add the sender check if not already equivalent. Your current code does `sender?.id && sender.id !== Browser.runtime.id` → return null, which is correct.

---

### 3. **Security: GET_COOKIE Payload Validation** (`304c612`)
**Use:** Validate `message.data.url` and `message.data.name` as non-empty strings, parse URL with `new URL()`, and use trimmed values.

**Why:** Prevents crashes and malformed inputs.

**Current state:** Your GET_COOKIE handler validates `url` and `name` as strings and uses `new URL(url)`. Adding explicit trim and validation for empty strings would align with upstream’s robustness.

---

### 4. **Security: Cookie Protocol and Header Validation** (`239aa4d`)
**Use:**
- Validate FETCH URL with `new URL()` and reject non-http(s) protocols
- Validate GET_COOKIE URL protocol (http/https only)
- Guard header iteration: `if (!header || !header.name) continue`
- Avoid logging full header values; log only safe names

**Why:** Avoids protocol confusion, invalid URLs, and crashes from malformed headers.

**Adoption:** Apply these patterns to your FETCH and GET_COOKIE handlers and any header-modification logic.

---

### 5. **Guard Custom API Mode Overrides** (`e2108a6`)
**Use:** Use optional chaining and nullish coalescing: `session.apiMode.customUrl?.trim() || ...` and `session.apiMode.apiKey?.trim() || ...`.

**Why:** Prevents crashes when `session.apiMode` or its properties are missing.

**Adoption:** Search for any `session.apiMode.customUrl.trim()` or similar and replace with optional chaining.

---

### 6. **Make Static Card Init Non-Blocking** (`04208f1`)
**Use:** Don’t `await` `prepareForStaticCard()`; instead call it and attach `.catch()` for error logging.

**Why:** Static card init shouldn’t block page load; failures should be logged but not crash the script.

**Current state:** You already call `prepareForStaticCard()` without `await` (fire-and-forget). **Add:** `.catch((error) => console.error('[content] Error in prepareForStaticCard (unhandled):', error))` for consistency and debugging.

---

### 7. **Guard Proxy Message Forwarding** (`090044e`)
**Use:** Before forwarding proxy messages: check `port._isClosed`; wrap `port.postMessage(msg)` in try/catch.

**Why:** Avoids errors when the main port is closed or disconnected.

**Adoption:** If you have similar proxy/port forwarding logic in the background script, add these guards.

---

### 8. **Improve Background Script Error Handling** (`1bd2a93`)
**Use:** Large refactor: reconnect logic with exponential backoff, sensitive field redaction in logs, proper cleanup of listeners and proxy ports.

**Why:** More stable connections and safer logging (no API keys, tokens, etc. in logs).

**Adoption:** Review the background script’s proxy/reconnect logic and redaction helpers. Adopt patterns that fit your architecture without a full copy.

---

## Medium-Value Commits (Consider Selectively)

### 9. **Model Updates**
- **Add Anthropic Claude Opus 4.5 & 4.6** (`3832a3d`)
- **Add OpenAI gpt-5.1-chat-latest** (`2a81de9`)
- **Add Gemini 3 and 3.1 OpenRouter** (`9746218`)
- **Remove Retired Models** (`718a985`, `5c12582`, `c435016`): OpenAI, Anthropic, OpenRouter, AIML

**Adoption:** Sync your model lists with these additions and removals. Your config structure differs; use upstream as a reference for which models to add/remove.

---

### 10. **Node Unit Tests** (`f9ef899`, `9ed7fa8`, `ab628e1`)
**Use:** Browser shim for Node, unit tests for SSE, API helpers, model config, guards.

**Adoption:** Add `tests/setup/browser-shim.mjs` and `npm test` script. Use upstream’s tests as inspiration for guards, token params, and utilities. Your `test:agent` is separate; keep both.

---

### 11. **Run npm Tests in CI** (`a410842`)
**Use:** Run `npm test` in CI before lint and build.

**Adoption:** Add `npm run test` to your `.github/workflows/pr-tests.yml` once you have Node tests.

---

### 12. **Security: npm audit fix** (`055d6b4`)
**Use:** Reduce vulnerabilities from 29 to 21.

**Adoption:** Run `npm audit` and `npm audit fix` (with care) to address known issues.

---

## Low-Value / Optional / N/A

### 13. **Dependency Bumps**
- `actions/setup-node` 5→6  
- `actions/upload-artifact` 4→6  
- `actions/checkout` 5→6  
- `actions/cache` 4→5  
- `jws` 3.2.2→3.2.3  

**Adoption:** Apply when convenient; no functional impact.

---

### 14. **Build Pipeline Refactor** (`11b4531`, `727b578`, `9537643`)
**Use:** esbuild minification, thread-loader, parallel builds, cache tuning, CI cache docs.

**Adoption:** Optional. Your build is different; only adopt if you’re actively optimizing build performance.

---

### 15. **Improve Content Script Stability** (`0dbe283`)
**Use:** Upstream-specific content script changes.

**Adoption:** Review the diff if you see similar stability issues; otherwise skip.

---

## Recommended Action Plan

1. **Immediate (correctness):**
   - Add GPT-5 token parameter fix (`openai-token-params.mjs` + `getChatCompletionsTokenParams`)
   - Add `.catch()` to `prepareForStaticCard()` if not already present

2. **Security:**
   - Validate GET_COOKIE payload (trim, URL validation, protocol check)
   - Validate FETCH URL and headers
   - Guard custom API mode overrides with optional chaining

3. **Reliability:**
   - Guard proxy message forwarding with `_isClosed` and try/catch
   - Add optional chaining for `session.apiMode` usage

4. **Models:**
   - Add Claude Opus 4.5/4.6, gpt-5.1-chat-latest, Gemini 3/3.1
   - Remove retired models per upstream lists

5. **Testing:**
   - Add Node unit tests and `npm test`
   - Run `npm test` in CI

6. **Maintenance:**
   - Run `npm audit fix` (with review)
   - Bump GitHub Actions when convenient

---

## Files to Reference in Upstream

For implementation details, inspect these files in `upstream/master`:

- `src/services/apis/openai-token-params.mjs` – token parameter logic
- `src/services/apis/openai-token-params.test.mjs` – unit tests
- `src/background/index.mjs` – security handlers, proxy guards
- `tests/setup/browser-shim.mjs` – Node test setup
