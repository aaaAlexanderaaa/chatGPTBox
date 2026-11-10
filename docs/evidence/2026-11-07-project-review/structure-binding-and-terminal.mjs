/* eslint-env node */
// Dated second-pass witnesses. No browser, account or model is invoked.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import parser from '@babel/parser'
import { createGrokChatWriter } from '../../../src/services/clients/grok-web/chat.mjs'
import { setAbortController } from '../../../src/services/apis/shared.mjs'
import { applyInbound } from '../../../src/hooks/conversation-runtime-reducers.mjs'
import { normalizeModelAnswer, unwrapAnswerFence } from '../../../src/services/model-answer.mjs'

const repository = fileURLToPath(new URL('../../../', import.meta.url))
const pickerFile = path.join(repository, 'src/components/ConversationCard/index.jsx')
const source = fs.readFileSync(pickerFile, 'utf8')
const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] })
let callback
function walk(node) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'VariableDeclarator' && node.id?.name === 'applyModelSelection')
    callback = node.init.arguments[0]
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') walk(value)
  }
}
walk(ast)
assert.ok(callback, 'Current picker callback must be found before the probe can run')
let saved
const session = {
  modelName: 'chatgptweb/synthetic-model',
  sessionId: 'synthetic-local-thread',
  conversationId: 'synthetic-chatgpt-thread',
  parentMessageId: 'synthetic-parent',
  conversationRecords: [{ question: 'old', answer: 'old answer' }],
}
const context = {
  session,
  config: { autoRegenAfterSwitchModel: false },
  conversationItemData: [],
  engineSelectionLabel: (value) => value,
  t: (value) => value,
  showMemoryNote() {},
  setModelPickerOpen() {},
  setModelPickerQuery() {},
  setSession(value) {
    saved = value
  },
  getRetryFn() {
    throw new Error('Unexpected retry in read-only probe')
  },
}
const change = vm.runInNewContext('(' + source.slice(callback.start, callback.end) + ')', context, {
  timeout: 1000,
  filename: pickerFile + ':picker-extract',
})
change({ modelName: 'grokweb/grok-chat-fast' })
let fetchCalls = 0
let error
try {
  await createGrokChatWriter({
    fetch: async () => {
      fetchCalls++
      throw new Error('Network forbidden in synthetic probe')
    },
  }).send({
    question: 'Synthetic next question',
    modelSlug: 'grok-chat-fast',
    conversationId: saved.conversationId,
    previousResponseID: saved.previousResponseID,
  })
} catch (failure) {
  error = failure.message
}
assert.equal(saved.conversationId, session.conversationId)
assert.match(error, /previousResponseID is required/)
assert.equal(fetchCalls, 0)
const crossProvider = {
  newEngine: saved.modelName,
  retainedRemoteId: saved.conversationId,
  retainedTranscript: saved.conversationRecords.length,
  error,
  writerFetchCalls: fetchCalls,
}
change({ modelName: 'chatgptweb/another-model' })
assert.equal(saved.conversationId, session.conversationId)
const sameProvider = { newEngine: saved.modelName, retainedRemoteId: saved.conversationId }

function eventSlot() {
  const listeners = new Set()
  return {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    emit: (message) => [...listeners].forEach((listener) => listener(message)),
  }
}
const acknowledgements = []
const port = {
  onMessage: eventSlot(),
  onDisconnect: eventSlot(),
  postMessage: (message) => acknowledgements.push(structuredClone(message)),
}
const { controller, cleanController } = setAbortController(port)
port.onMessage.emit({ stop: true })
assert.equal(controller.signal.aborted, true)
assert.deepEqual(acknowledgements, [{ done: true }])
let state = {
  items: [{ type: 'answer', content: 'This is an unfinished rewritten', done: false }],
  session: { sessionId: 'synthetic' },
  isReady: false,
}
for (const message of acknowledgements) state = applyInbound(state, message, (value) => value)
const item = state.items.at(-1)
const normalized = normalizeModelAnswer(item.content)
const eligibility = {
  type: item.type,
  done: item.done,
  isReady: state.isReady,
  rewriteResultWouldRender: item.type === 'answer' && item.done,
  nonemptyReplacement: !!unwrapAnswerFence(normalized.text).trim(),
}
assert.equal(eligibility.rewriteResultWouldRender, true)
assert.equal(eligibility.nonemptyReplacement, true)
cleanController()
console.log(
  JSON.stringify(
    {
      node: process.version,
      method:
        'Current picker callback extracted unchanged from JSX AST; actual Grok writer, Stop helper and reducer with synthetic inputs',
      crossProvider,
      sameProvider,
      stopAcknowledgements: acknowledgements,
      partialResultEligibility: eligibility,
    },
    null,
    2,
  ),
)
