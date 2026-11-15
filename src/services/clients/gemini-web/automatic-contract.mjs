import references from '../../../config/gemini-code-references.json'
import { GEMINI_NATIVE_CONTRACTS } from '../../../config/gemini-web.mjs'
import { extractNativeHashes, matchCodeReference } from './code-equivalence.mjs'

export async function resolveAutomaticGeminiContract(inventory, options = {}) {
  const known = options.contracts || GEMINI_NATIVE_CONTRACTS
  const seeds = options.references || references
  const fetcher = options.fetch || globalThis.fetch
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
    !seeds.some((seed) => seed.units.length === inventory.sourceUrls.length)
  )
    return null
  for (const raw of inventory.sourceUrls) {
    try {
      if (typeof raw !== 'string' || raw.length > 4096) return null
      const url = new URL(raw)
      if (
        url.origin !== 'https://gemini.gstatic.com' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !url.pathname.startsWith('/_/js/') ||
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
        nonce: inventory.nonce,
        version: inventory.version,
        sourceUrls: [...inventory.sourceUrls].sort(),
        referenceVersion: profile.version,
      }
      matches.push(contract)
    }
    return matches.length === 1 ? matches[0] : null
  } catch {
    return null
  } finally {
    controller.abort()
    clearTimeout(timer)
  }
}
