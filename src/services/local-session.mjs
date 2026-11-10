import Browser from 'webextension-polyfill'
import { initSession } from './init-session.mjs'
import { getUserConfig } from '../config/index.mjs'
import { RuntimeMessage } from '../protocol/messages.mjs'

export const initDefaultSession = async () => {
  const config = await getUserConfig()
  return initSession({
    sessionName: new Date().toLocaleString(),
    modelName: config.modelName,
    apiMode: config.apiMode,
    autoClean: false,
    extraCustomModelName: config.customModelName,
  })
}
async function readSessions() {
  const { sessions } = await Browser.storage.local.get('sessions')
  return Array.isArray(sessions) ? sessions : []
}
async function resetSessionsImpl() {
  const sessions = [await initDefaultSession()]
  await Browser.storage.local.set({ sessions })
  return sessions
}
async function ensureSessionsImpl() {
  const sessions = await readSessions()
  return sessions.length ? sessions : resetSessionsImpl()
}
function assertBindingTransition(previous, next) {
  const current = previous.remoteBindingGeneration || null
  const incoming = next.remoteBindingGeneration || null
  if (incoming === current) return
  if (
    incoming &&
    Object.hasOwn(next, 'remoteBindingParentGeneration') &&
    (next.remoteBindingParentGeneration === current ||
      (Array.isArray(next.remoteBindingAncestors) &&
        next.remoteBindingAncestors.length <= 64 &&
        next.remoteBindingAncestors.includes(current)))
  )
    return
  const error = new Error(
    'This conversation changed connection in another window. The saved binding was kept; reopen the saved conversation before continuing.',
  )
  error.code = 'SESSION_BINDING_CHANGED'
  throw error
}
async function createSessionImpl(session) {
  const currentSessions = await ensureSessionsImpl()
  const next = session || (await initDefaultSession())
  const index = currentSessions.findIndex((item) => item.sessionId === next.sessionId)
  if (index >= 0) {
    assertBindingTransition(currentSessions[index], next)
    currentSessions[index] = next
  } else currentSessions.unshift(next)
  await Browser.storage.local.set({ sessions: currentSessions })
  return { session: next, currentSessions }
}
async function updateSessionImpl(session) {
  const sessions = await readSessions()
  const index = sessions.findIndex((item) => item.sessionId === session.sessionId)
  if (index < 0) {
    const error = new Error(
      'This conversation was removed in another window. The current view was kept; reopen the saved conversation before continuing.',
    )
    error.code = 'SESSION_NOT_FOUND'
    throw error
  }
  assertBindingTransition(sessions[index], session)
  sessions[index] = { ...session, updatedAt: new Date().toISOString() }
  await Browser.storage.local.set({ sessions })
  return sessions
}
async function deleteSessionImpl(id) {
  const sessions = await ensureSessionsImpl()
  const next = sessions.filter((item) => item.sessionId !== id)
  if (next.length === sessions.length) return sessions
  if (!next.length) return resetSessionsImpl()
  await Browser.storage.local.set({ sessions: next })
  return next
}
let localMutationOwner = false
let writeQueue = Promise.resolve()
export function registerLocalSessionMutationOwner() {
  localMutationOwner = true
}
export function applyLocalSessionMutation(method, payload = {}) {
  if (!['ensure', 'create', 'update', 'prepareDispatch', 'delete', 'reset'].includes(method))
    throw new Error('Unsupported local session mutation')
  if (
    (method === 'update' ||
      method === 'prepareDispatch' ||
      (method === 'create' && payload.session)) &&
    (typeof payload.session?.sessionId !== 'string' || !payload.session.sessionId)
  )
    throw new Error('Invalid local session identity')
  if (method === 'delete' && typeof payload.id !== 'string')
    throw new Error('Invalid local session identity')
  const snapshot = structuredClone(payload)
  const run = writeQueue.then(() =>
    ({
      ensure: ensureSessionsImpl,
      create: () => createSessionImpl(snapshot.session),
      update: () => updateSessionImpl(snapshot.session),
      prepareDispatch: () => updateSessionImpl(snapshot.session),
      delete: () => deleteSessionImpl(snapshot.id),
      reset: resetSessionsImpl,
    }[method]()),
  )
  writeQueue = run.catch(() => {})
  return run
}
async function mutate(method, payload) {
  const snapshot = structuredClone(payload)
  if (localMutationOwner) return applyLocalSessionMutation(method, snapshot)
  const reply = await Browser.runtime.sendMessage({
    type: RuntimeMessage.LocalSessionMutation,
    data: { method, payload: snapshot },
  })
  if (reply?.ok !== true) {
    const error = new Error(
      reply?.error?.message ||
        'The background did not save this conversation. Reopen the saved conversation before continuing.',
    )
    error.code = reply?.error?.code || 'SESSION_SAVE_FAILED'
    throw error
  }
  return reply.value
}
export const createSession = (session) => mutate('create', { session })
export const updateSession = (session) => mutate('update', { session })
export const prepareLocalSessionDispatch = (session) =>
  applyLocalSessionMutation('prepareDispatch', { session })
export const deleteSession = (id) => mutate('delete', { id })
export const resetSessions = () => mutate('reset', {})
export const getSessions = async () => {
  const sessions = await readSessions()
  return sessions.length ? sessions : mutate('ensure', {})
}
export const getSession = async (sessionId) => {
  const currentSessions = await getSessions()
  return {
    session: currentSessions.find((session) => session.sessionId === sessionId),
    currentSessions,
  }
}
