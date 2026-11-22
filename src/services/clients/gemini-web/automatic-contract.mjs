import references from '../../../config/gemini-code-references.json'
import {
  GEMINI_NATIVE_CONTRACTS,
  GEMINI_WEB_MODEL_DESCRIPTION,
  GEMINI_WEB_THINKING_LEVEL,
} from '../../../config/gemini-web.mjs'
import { extractNativeHashes, matchCodeReference } from './code-equivalence.mjs'
import { discoverStructuralGeminiContract } from './structural-contract.mjs'

export async function resolveAutomaticGeminiContract(inventory, options = {}) {
  const known = options.contracts || GEMINI_NATIVE_CONTRACTS
  const seeds = options.references || references
  const fetcher = options.fetch || globalThis.fetch
  const isCoreScope = inventory?.scope === 'core'
  const canTryReference =
    !isCoreScope && seeds.some((seed) => seed.units.length === inventory?.sourceUrls?.length)
  const canTryStructural =
    options.allowStructural !== false &&
    Array.isArray(inventory?.sourceUrls) &&
    inventory.sourceUrls.length >= 2 &&
    inventory.sourceUrls.length <= 4
  if (
    inventory?.ok !== true ||
    typeof inventory.nonce !== 'string' ||
    !inventory.nonce ||
    inventory.nonce.length > 100 ||
    !/^boq-gemini-web-uiserver\.BardChatUi\.[a-zA-Z0-9_.-]{1,180}$/.test(inventory.version || '') ||
    !Array.isArray(inventory.sourceUrls) ||
    !inventory.sourceUrls.length ||
    inventory.sourceUrls.length > 4 ||
    new Set(inventory.sourceUrls).size !== inventory.sourceUrls.length ||
    (inventory.scope !== undefined && inventory.scope !== 'core') ||
    (!canTryReference && !canTryStructural)
  )
    return null
  for (const raw of inventory.sourceUrls) {
    try {
      if (typeof raw !== 'string' || raw.length > 4096) return null
      const url = new URL(raw)
      const decodedPath = decodeURIComponent(url.pathname)
      if (
        url.origin !== 'https://gemini.gstatic.com' ||
        url.username ||
        url.password ||
        (url.search && !/^\?wli=BardChatUi\.[a-zA-Z0-9_.%:-]{1,200}$/.test(url.search)) ||
        url.hash ||
        /(?:^|\/)\.\.?(?:\/|$)/.test(decodedPath) ||
        (!url.pathname.startsWith('/_/js/') &&
          !url.pathname.startsWith('/_/mss/boq-gemini-web-uiserver/_/js/')) ||
        !url.pathname.includes(`/k=${inventory.version}/`)
      )
        return null
    } catch {
      return null
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  let total = 0
  try {
    const sources = await Promise.all(
      inventory.sourceUrls.map(async (url) => {
        const response = await fetcher(url, {
          method: 'GET',
          credentials: 'omit',
          redirect: 'error',
          cache: 'force-cache',
          signal: controller.signal,
        })
        if (
          !response.ok ||
          (response.url && response.url !== url) ||
          Number(response.headers.get('content-length')) > 8 * 1024 * 1024
        )
          throw new Error('Public code unavailable.')
        const reader = response.body?.getReader()
        if (!reader) throw new Error('Public code unavailable.')
        const decoder = new TextDecoder('utf-8', { fatal: true })
        let source = ''
        try {
          for (;;) {
            const chunk = await reader.read()
            if (chunk.done) break
            total += chunk.value.byteLength
            if (total > 8 * 1024 * 1024)
              throw new Error('Public code exceeds the inspection limit.')
            source += decoder.decode(chunk.value, { stream: true })
          }
          return source + decoder.decode()
        } finally {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
      }),
    )
    const matches = []
    if (canTryReference) {
      for (const seed of seeds) {
        const profile = known.find((item) => item.version === seed.referenceVersion)
        if (!profile?.history) continue
        const match = matchCodeReference(sources, seed)
        if (!match) continue
        const rename = (value) => match.names.fields.get(value) || value
        const namespace = (value) => match.names.namespace.get(value) || value
        const contract = {
          ...profile,
          version: inventory.version,
          fields: Object.fromEntries(
            Object.entries(profile.fields).map(([key, value]) => [key, rename(value)]),
          ),
          history: Object.fromEntries(
            Object.entries(profile.history).map(([key, value]) => [
              key,
              key === 'apiClass' ? namespace(value) : rename(value),
            ]),
          ),
        }
        for (const key of [
          'viewMap',
          'inputClass',
          'serviceClass',
          'prepareFunction',
          'attestationFunction',
          'thinkingSetter',
        ])
          contract[key] = namespace(profile[key])
        contract.hashes = await extractNativeHashes(match.ordered, contract)
        contract.automaticProof = {
          mode: 'complete',
          nonce: inventory.nonce,
          version: inventory.version,
          sourceUrls: [...inventory.sourceUrls].sort(),
          referenceVersion: profile.version,
          unavailableExports: (seed.receiverContract.unavailableExports || []).map(namespace),
          requiresNoWizbind: seed.receiverContract.requiresNoWizbind === true,
        }
        matches.push(contract)
      }
      if (matches.length === 1) return matches[0]
      if (matches.length > 1) return null
    }
    if (canTryStructural) {
      const targetModel = known[0]?.modelDescription || GEMINI_WEB_MODEL_DESCRIPTION
      const targetThinking = known[0]?.thinkingLevel || GEMINI_WEB_THINKING_LEVEL
      let structuralSources = sources
      let structuralUrls = [...inventory.sourceUrls].sort()
      if (inventory.sourceUrls.length > 2) {
        const runtimeIndices = []
        const vLefieIndices = []
        const exmIndices = []
        inventory.sourceUrls.forEach((raw, idx) => {
          const pathname = new URL(raw).pathname
          if (/\/m=_b(?:\/|$)/.test(pathname)) runtimeIndices.push(idx)
          else {
            if (/\/m=vLefie(?:\/|$)/.test(pathname)) vLefieIndices.push(idx)
            if (/\/exm=_b\//.test(pathname)) exmIndices.push(idx)
          }
        })
        const appIndices = vLefieIndices.length === 1 ? vLefieIndices : exmIndices
        if (runtimeIndices.length === 1 && appIndices.length === 1) {
          const pair = [runtimeIndices[0], appIndices[0]]
          structuralSources = pair.map((idx) => sources[idx])
          structuralUrls = pair.map((idx) => inventory.sourceUrls[idx]).sort()
        }
      }
      const structural = await discoverStructuralGeminiContract(
        structuralSources,
        inventory.version,
        {
          modelDescription: targetModel,
          thinkingLevel: targetThinking,
        },
      )
      if (structural) {
        structural.automaticProof = {
          mode: 'structural-core',
          nonce: inventory.nonce,
          version: inventory.version,
          sourceUrls: structuralUrls,
        }
        return structural
      }
    }
    return null
  } catch {
    return null
  } finally {
    controller.abort()
    clearTimeout(timer)
  }
}
