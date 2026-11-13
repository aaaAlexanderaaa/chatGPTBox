// Pure protocol shared by the browser runtime, gateway and MCP clients.
export const ENGINE_CONTRACT_VERSION = 1
export const ENGINE_BRIDGE_PROTOCOL = 'chatgptbox-engine/1'
export const ENGINE_RUN_STORAGE_KEY = 'engineRuntimeV1'

export const EngineOperation = Object.freeze({
  Generate: 'generation.start',
  Append: 'conversation.append',
  ReadConversation: 'conversation.read',
  ListConversations: 'conversation.list',
  ReadRun: 'run.read',
  RecoverRun: 'run.recover',
  CancelRun: 'run.cancel',
})

export const EngineMethod = Object.freeze({
  List: 'engines.list',
  Models: 'engines.models',
  Invoke: 'engines.invoke',
  Read: 'runs.read',
  Recover: 'runs.recover',
  Cancel: 'runs.cancel',
  ReadConversation: 'conversations.read',
  ListConversations: 'conversations.list',
})

const ERROR_STATUS = {
  ENGINE_DISABLED: 403,
  EXTERNAL_ACCESS_DISABLED: 403,
  OPERATION_NOT_EXPOSED: 403,
  OPERATION_NOT_IMPLEMENTED: 422,
  ENGINE_NOT_FOUND: 404,
  INPUT_UNSUPPORTED: 400,
  PARAMETER_UNSUPPORTED: 400,
  INVALID_REQUEST: 400,
  MODEL_UNAVAILABLE: 422,
  ENGINE_NOT_READY: 409,
  ENGINE_BUSY: 409,
  CONTEXT_UNAVAILABLE: 409,
  BINDING_CHANGED: 409,
  RUN_CONFLICT: 409,
  RESULT_UNCERTAIN: 409,
  RESULT_UNAVAILABLE: 410,
  STORAGE_UNAVAILABLE: 503,
  BRIDGE_UNAVAILABLE: 503,
  UPSTREAM_REJECTED: 502,
}

const UNSENT_ERRORS = new Set([
  'ENGINE_DISABLED',
  'EXTERNAL_ACCESS_DISABLED',
  'OPERATION_NOT_EXPOSED',
  'OPERATION_NOT_IMPLEMENTED',
  'ENGINE_NOT_FOUND',
  'INPUT_UNSUPPORTED',
  'PARAMETER_UNSUPPORTED',
  'INVALID_REQUEST',
  'MODEL_UNAVAILABLE',
  'ENGINE_NOT_READY',
  'ENGINE_BUSY',
  'CONTEXT_UNAVAILABLE',
  'BINDING_CHANGED',
  'INSTALLATION_CHANGED',
  'ENGINE_CAPACITY',
  'RUN_CONFLICT',
])

export class EngineError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'EngineError'
    this.code = code
    this.status = details.status || ERROR_STATUS[code] || 500
    this.submission =
      details.submission || (UNSENT_ERRORS.has(code) ? 'not_attempted' : 'possibly_submitted')
    this.retryable = false
    this.nextAction = details.nextAction || 'Inspect the reported state before trying again.'
    if (details.runId) this.runId = details.runId
    if (this.submission === 'not_attempted') this.dispatched = false
  }
}

export function serializeEngineError(error, defaults = {}) {
  const submission =
    error?.submission ||
    (error?.dispatched === false || error?.chatgptWebNotDispatched === true
      ? 'not_attempted'
      : defaults.submission || 'possibly_submitted')
  return {
    code: error?.code || defaults.code || 'UPSTREAM_REJECTED',
    message: error?.message || String(error || 'Engine operation failed'),
    status: error?.status || defaults.status || 502,
    submission,
    retryable: false,
    nextAction:
      error?.nextAction || defaults.nextAction || 'Inspect this execution; do not resubmit it.',
    ...(error?.runId || defaults.runId ? { runId: error?.runId || defaults.runId } : {}),
    ...(submission === 'not_attempted' ? { dispatched: false } : {}),
  }
}

export function throwEngineError(error) {
  if (!error) return
  throw new EngineError(error.code || 'UPSTREAM_REJECTED', error.message, error)
}

export function assertRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new EngineError('INVALID_REQUEST', `${name} must be an object.`)
  return value
}

export function assertKnownFields(value, allowed, name) {
  assertRecord(value, name)
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length)
    throw new EngineError(
      'INPUT_UNSUPPORTED',
      `${name} has unsupported fields: ${unknown.join(', ')}.`,
    )
}

export function validateEngineRequest(value) {
  assertKnownFields(
    value,
    [
      'contractVersion',
      'engineId',
      'operation',
      'modelId',
      'input',
      'conversation',
      'parameters',
      'extensions',
    ],
    'Engine request',
  )
  if (value.contractVersion !== ENGINE_CONTRACT_VERSION)
    throw new EngineError('INVALID_REQUEST', 'Unsupported engine contract version.')
  if (typeof value.engineId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.engineId))
    throw new EngineError('INVALID_REQUEST', 'A valid engineId is required.')
  if (![EngineOperation.Generate, EngineOperation.Append].includes(value.operation))
    throw new EngineError(
      'OPERATION_NOT_IMPLEMENTED',
      'This endpoint accepts generation.start or conversation.append.',
    )
  if (value.modelId !== undefined && (typeof value.modelId !== 'string' || !value.modelId.trim()))
    throw new EngineError('INVALID_REQUEST', 'modelId must be a nonempty string when supplied.')
  assertKnownFields(value.input, ['prompt', 'attachments'], 'input')
  if (typeof value.input.prompt !== 'string' || !value.input.prompt.trim())
    throw new EngineError('INVALID_REQUEST', 'input.prompt must contain text.')
  if (value.input.attachments !== undefined && !Array.isArray(value.input.attachments))
    throw new EngineError('INPUT_UNSUPPORTED', 'input.attachments must be an array.')
  if (value.parameters !== undefined) assertRecord(value.parameters, 'parameters')
  if (value.extensions !== undefined) assertRecord(value.extensions, 'extensions')
  if (value.operation === EngineOperation.Generate && value.conversation !== undefined)
    throw new EngineError(
      'INVALID_REQUEST',
      'Independent generation cannot carry a conversation binding.',
    )
  if (value.operation === EngineOperation.Append) {
    assertKnownFields(value.conversation, ['ref', 'expectedRevision'], 'conversation')
    if (typeof value.conversation.ref !== 'string' || !value.conversation.ref.trim())
      throw new EngineError(
        'CONTEXT_UNAVAILABLE',
        'A conversation reference is required for append.',
      )
    if (
      !Number.isSafeInteger(value.conversation.expectedRevision) ||
      value.conversation.expectedRevision < 0
    )
      throw new EngineError(
        'BINDING_CHANGED',
        'The current conversation revision is required for append.',
      )
  }
  return value
}

// Canonical input identity, not a hash of the prompt used to merge different runs.
export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  assertRecord(value, 'JSON value')
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`
}

export async function fingerprintEngineRequest(request) {
  const bytes = new TextEncoder().encode(canonicalJson(request))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export function compilePromptTranscript(messages) {
  if (!Array.isArray(messages) || !messages.length)
    throw new EngineError('INVALID_REQUEST', 'messages must be a nonempty array.')
  const labels = { system: 'System', developer: 'Developer', assistant: 'Assistant', user: 'User' }
  const normalized = messages.map((message) => {
    assertKnownFields(message, ['role', 'content'], 'message')
    if (!Object.hasOwn(labels, message.role))
      throw new EngineError(
        'INPUT_UNSUPPORTED',
        `Unsupported message role: ${String(message.role)}.`,
      )
    let content = message.content
    if (Array.isArray(content)) {
      content = content
        .map((part) => {
          assertKnownFields(part, ['type', 'text'], 'message content')
          if (part.type !== 'text' || typeof part.text !== 'string')
            throw new EngineError(
              'INPUT_UNSUPPORTED',
              'Only prepared text blocks are accepted by the transcript projection.',
            )
          return part.text
        })
        .join('\n')
    }
    if (typeof content !== 'string')
      throw new EngineError('INPUT_UNSUPPORTED', 'Message content must be text.')
    return { role: message.role, content }
  })
  const prompt =
    normalized.length === 1 && normalized[0].role === 'user'
      ? normalized[0].content
      : 'Supplied conversation transcript (JSON data; no native role privileges):\n' +
        JSON.stringify({ format: 'prompt-transcript-v1', messages: normalized })
  if (!prompt.trim()) throw new EngineError('INVALID_REQUEST', 'messages must contain text.')
  return { prompt, projection: 'prompt-transcript-v1' }
}
