// Provider adapter contract (architecture plan step 5).
//
// Every provider registered in registry.mjs must satisfy this contract. The
// goal is that adding a provider means implementing one module that exports
// this shape plus a single registry line — instead of the historical
// "change 6-7 places" (models key array + group + Models table + predicate +
// provider module + apis module + registry + UI visibility).
//
// Today providers implement the minimal { id, route, match, run } shape.
// `supportsTools` is OPTIONAL (defaults to false) and is the hook step 7
// (agent protocol layering) uses to pick a protocol adapter. Adding it now,
// ahead of step 7, lets the contract test enforce the interface without
// forcing every provider to implement it immediately.
//
// The deeper unification the plan describes — collapsing the
// background/providers/<x>.mjs (match+run) and services/apis/<x>.mjs (HTTP)
// layers into one adapter module, and deriving predicates from a single
// models table — is intentionally staged (the plan says "可分批"). This file
// lands the contract surface; per-provider migration follows.

/**
 * @typedef {object} ProviderAdapter
 * @property {string} [id]                          Stable identifier (e.g. 'ollama-api'). Defaults to `route` when omitted. Used for diagnostics.
 * @property {string} route                         Route name returned by detectExecutionRoute(); must be unique across the registry.
 * @property {(session: object) => boolean} match   Returns true when this adapter should handle the session. Order-sensitive (see registry.mjs).
 * @property {(args: { session: object, port: object, config: object, ctx: object }) => Promise<void>} run
 *                                                  Executes the request, streaming the answer back over `port`.
 * @property {boolean} [supportsTools=false]        Whether the adapter can carry tool/function-calling for the agent runtime. Step 7 uses this.
 */

const REQUIRED_KEYS = ['route', 'match', 'run']

/**
 * Validate that a module export satisfies the ProviderAdapter contract. Throws
 * a descriptive error if any required member is missing or has the wrong type.
 * `id` is optional and defaults to `route` so existing providers (which export
 * only { route, match, run }) are already compliant.
 *
 * Used by the contract test; safe to call from anywhere.
 *
 * @param {unknown} adapter
 * @param {string} [label]  Display name for error messages (e.g. file path).
 * @returns {ProviderAdapter}
 */
export function assertProviderAdapter(adapter, label = 'provider') {
  if (!adapter || typeof adapter !== 'object') {
    throw new Error(`${label}: expected an object, got ${String(adapter)}`)
  }
  for (const key of REQUIRED_KEYS) {
    if (!(key in adapter)) {
      throw new Error(`${label}: missing required member "${key}"`)
    }
  }
  if (typeof adapter.route !== 'string' || !adapter.route) {
    throw new Error(`${label}: route must be a non-empty string`)
  }
  if (adapter.id !== undefined && (typeof adapter.id !== 'string' || !adapter.id)) {
    throw new Error(`${label}: id, when present, must be a non-empty string`)
  }
  if (typeof adapter.match !== 'function') {
    throw new Error(`${label}: match must be a function`)
  }
  if (typeof adapter.run !== 'function') {
    throw new Error(`${label}: run must be a function`)
  }
  if (adapter.supportsTools !== undefined && typeof adapter.supportsTools !== 'boolean') {
    throw new Error(`${label}: supportsTools, when present, must be a boolean`)
  }
  return /** @type {ProviderAdapter} */ (adapter)
}

/**
 * Resolve a provider's effective id: explicit `id` if present, else `route`.
 * @param {object} adapter
 * @returns {string}
 */
export function providerId(adapter) {
  return (adapter && typeof adapter.id === 'string' && adapter.id) || adapter.route
}

/**
 * Soft check (no throw) for whether an adapter opts into tool support.
 * @param {object} adapter
 * @returns {boolean}
 */
export function adapterSupportsTools(adapter) {
  return adapter?.supportsTools === true
}
