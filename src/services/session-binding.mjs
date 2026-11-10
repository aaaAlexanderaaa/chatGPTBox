import { v4 as uuid } from 'uuid'
import { getSelectionString, parseEngineSelection } from '../config/engine-selection.mjs'

const REMOTE_FIELDS = [
  'conversationId',
  'messageId',
  'parentMessageId',
  'wsRequestId',
  'previousResponseID',
  'dshSessionId',
  'dshWorkspaceId',
  'dshEndpoint',
  'moonshot_conversation',
  'chatgptWebProjectId',
  'chatgptWebImagePointers',
  'chatgptWebModelSlugOverride',
]

export function switchSessionEngine(session, modelName) {
  const previous = parseEngineSelection(getSelectionString(session))?.providerId
  const next = parseEngineSelection(modelName)?.providerId
  const result = { ...session, modelName, apiMode: null, isRetry: false, retryReplacement: null }
  if (!previous || previous !== next) {
    for (const key of REMOTE_FIELDS) result[key] = null
    result.remoteBindingParentGeneration = session.remoteBindingGeneration || null
    result.remoteBindingAncestors = [
      ...new Set([
        result.remoteBindingParentGeneration,
        ...(Array.isArray(session.remoteBindingAncestors) ? session.remoteBindingAncestors : []),
      ]),
    ].slice(0, 64)
    result.remoteBindingGeneration = uuid()
  }
  return result
}

export function bindingSnapshotKey(session) {
  return session.remoteBindingGeneration
    ? `${session.sessionId}:${session.remoteBindingGeneration}`
    : session.sessionId
}

export function sameBindingGeneration(left, right) {
  return (left.remoteBindingGeneration || null) === (right.remoteBindingGeneration || null)
}
