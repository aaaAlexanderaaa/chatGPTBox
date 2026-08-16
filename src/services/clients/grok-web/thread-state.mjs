export const GROK_WEB_THREAD_SNAPSHOTS_KEY = 'grokWebThreadSnapshots'

async function getBrowserStorage() {
  const { default: Browser } = await import('webextension-polyfill')
  return Browser.storage.local
}

async function resolveStorageOptions({ storage, key } = {}) {
  return {
    storage: storage || (await getBrowserStorage()),
    key: key || GROK_WEB_THREAD_SNAPSHOTS_KEY,
  }
}

/**
 * Persist extension-born Grok continuation ids only.
 * Never imports or lists grok.com-native threads.
 */
export async function saveGrokWebSessionSnapshot(session, options = {}) {
  if (!session || typeof session !== 'object') return null
  if (typeof session.sessionId !== 'string' || !session.sessionId) return null

  const { storage, key } = await resolveStorageOptions(options)
  const snapshot = {
    sessionId: session.sessionId,
    conversationId: session.conversationId ?? null,
    previousResponseID: session.previousResponseID ?? null,
    modelName: session.modelName ?? null,
  }

  const data = await storage.get(key)
  const snapshots =
    data?.[key] && typeof data[key] === 'object' ? { ...data[key] } : {}
  snapshots[session.sessionId] = snapshot
  await storage.set({ [key]: snapshots })
  return snapshot
}

/**
 * Restore a previously saved extension-born snapshot by sessionId.
 */
export async function restoreGrokWebSessionSnapshot(sessionId, options = {}) {
  if (typeof sessionId !== 'string' || !sessionId) return null

  const { storage, key } = await resolveStorageOptions(options)
  const data = await storage.get(key)
  const snapshots =
    data?.[key] && typeof data[key] === 'object' ? data[key] : {}
  const snapshot = snapshots[sessionId]
  if (!snapshot || typeof snapshot !== 'object') return null
  return snapshot
}
