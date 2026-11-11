import {
  bindingSnapshotKey,
  isSessionSnapshotKey,
  sameBindingGeneration,
} from '../../session-binding.mjs'
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
    remoteBindingGeneration: session.remoteBindingGeneration || null,
    conversationId: session.conversationId ?? null,
    previousResponseID: session.previousResponseID ?? null,
    modelName: session.modelName ?? null,
  }

  const data = await storage.get(key)
  const snapshots = data?.[key] && typeof data[key] === 'object' ? { ...data[key] } : {}
  const existing =
    snapshots[bindingSnapshotKey(session)] &&
    typeof snapshots[bindingSnapshotKey(session)] === 'object'
      ? snapshots[bindingSnapshotKey(session)]
      : null
  const next = {
    sessionId: session.sessionId,
    remoteBindingGeneration: session.remoteBindingGeneration || null,
    conversationId: snapshot.conversationId || existing?.conversationId || null,
    previousResponseID: snapshot.previousResponseID || existing?.previousResponseID || null,
    modelName: snapshot.modelName ?? existing?.modelName ?? null,
  }
  snapshots[bindingSnapshotKey(session)] = next
  await storage.set({ [key]: snapshots })
  return next
}

/**
 * Restore a previously saved extension-born snapshot by sessionId.
 */
export async function restoreGrokWebSessionSnapshot(sessionId, options = {}) {
  if (typeof sessionId !== 'string' || !sessionId) return null

  const { storage, key } = await resolveStorageOptions(options)
  const data = await storage.get(key)
  const snapshots = data?.[key] && typeof data[key] === 'object' ? data[key] : {}
  const snapshot = snapshots[sessionId]
  if (!snapshot || typeof snapshot !== 'object') return null
  return snapshot
}

export async function deleteGrokWebSessionSnapshot(sessionId, options = {}) {
  if (typeof sessionId !== 'string' || !sessionId) return
  const { storage, key } = await resolveStorageOptions(options)
  const data = await storage.get(key)
  const snapshots = data?.[key] && typeof data[key] === 'object' ? { ...data[key] } : {}
  const keys = Object.keys(snapshots).filter((key) => isSessionSnapshotKey(key, sessionId))
  if (!keys.length) return
  for (const key of keys) delete snapshots[key]
  await storage.set({ [key]: snapshots })
}

/**
 * Remount helper: fill missing continuation ids from the extension-born snapshot.
 * Leaves the session unchanged when both ids are already present or no snapshot exists.
 */
export async function restoreGrokWebSessionOnto(session, options = {}) {
  if (!session || typeof session !== 'object') return session
  if (session.conversationId && session.previousResponseID) return session
  const snapshot = await restoreGrokWebSessionSnapshot(bindingSnapshotKey(session), options)
  if (!snapshot || !sameBindingGeneration(session, snapshot)) return session
  return {
    ...session,
    conversationId: session.conversationId || snapshot.conversationId,
    previousResponseID: session.previousResponseID || snapshot.previousResponseID,
  }
}
