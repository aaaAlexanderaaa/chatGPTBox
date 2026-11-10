/* eslint-env node */
// Dated synthetic defect witness. A fix can make these baseline assertions fail.
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { OperationLedger } from '../../../scripts/lib/operation-ledger.mjs'
import { ImageSendOperations } from '../../../scripts/lib/image-send-operations.mjs'
const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '')
const file = fs.readFileSync(root + '/src/background/chatgpt-proxy-service.mjs', 'utf8')
const start = file.indexOf('export async function sendChatgptWebConversationMessageThroughProxy')
const end = file.indexOf('\nexport async function createChatgptWebConversation', start)
const functionSource = file.slice(start, end).replace('export async function', 'async function')
let writes = 0
const context = vm.createContext({
  getChatgptWebThinkingEffortOverride: () => null,
  getChatgptWebConversationWithFallback: async () => {
    const error = new Error('HTTP 401: login expired')
    error.status = 401
    throw error
  },
  executeApiRef: async () => {
    writes++
  },
})
vm.runInContext(
  functionSource + '\nglobalThis.followup = sendChatgptWebConversationMessageThroughProxy',
  context,
)
let failure
try {
  await context.followup({
    conversationId: 'existing',
    query: 'Next question',
    operationId: 'same-operation',
  })
} catch (error) {
  failure = error
}
assert.equal(writes, 0)
assert.equal(failure.chatgptWebNotDispatched, undefined)
const ledger = new OperationLedger()
const record = ledger.begin({ key: 'drafts-preflight', fingerprint: 'same' }).record
const manager = new ImageSendOperations({
  ledger,
  attachments: { resolve: () => [] },
  dispatch: async () => {
    throw failure
  },
})
manager.start(
  record,
  { query: 'Next question', conversationId: 'existing', attachmentIds: [] },
  'chatgpt_web_send_conversation_message',
)
while (manager.active.has(record.operationId))
  await new Promise((resolve) => setTimeout(resolve, 1))
assert.equal(manager.snapshot(record).phase, 'ambiguous')
assert.equal(manager.snapshot(record).retryable, false)
manager.start(
  record,
  { query: 'Next question', conversationId: 'existing', attachmentIds: [] },
  'chatgpt_web_send_conversation_message',
)
assert.equal(manager.active.has(record.operationId), false)
console.log(
  JSON.stringify({
    case: 'followup-preflight-failure',
    remoteWrites: writes,
    error: failure.message,
    explicitNotDispatched: failure.chatgptWebNotDispatched ?? null,
    operation: manager.snapshot(record),
  }),
)
