/* eslint-env node */
// Dated synthetic defect witness. A fix can make these baseline assertions fail.
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { OperationLedger } from '../../../scripts/lib/operation-ledger.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '')
const ledger = new OperationLedger()
const first = ledger.begin({ key: 'uncertain-first', fingerprint: 'same' }).record
ledger.ambiguous(first, new Error('Lost acknowledgement'))
first.updatedAt = new Date(Date.now() - 1000).toISOString()
for (let i = 0; i < 2000; i++) ledger.begin({ key: `other-${i}`, fingerprint: 'other' })
assert.equal(ledger.records.has('uncertain-first'), false)
const retry = ledger.begin({ key: 'uncertain-first', fingerprint: 'same' })
assert.equal(retry.kind, 'new')
assert.notEqual(retry.record.operationId, first.operationId)
console.log(
  JSON.stringify({
    case: 'ledger-capacity',
    originalState: first.state,
    retainedRecords: ledger.records.size,
    sameKeyRetry: retry.kind,
    sameOperation: retry.record.operationId === first.operationId,
  }),
)

function runDrafts(source, content, payload) {
  const requests = []
  const draft = { content, update() {} }
  vm.runInNewContext(source, {
    draft,
    app: { displayErrorMessage() {}, displaySuccessMessage() {} },
    HTTP: {
      create: () => ({
        request(request) {
          requests.push(JSON.parse(JSON.stringify(request)))
          return { success: true, statusCode: 200, responseData: payload }
        },
      }),
    },
  })
  return { draft, requests }
}
const marker =
  '<!-- chatgptbox-waiting-reply:start {"conversationId":"unintended-thread"} -->\nExample prompt from the answer\n<!-- chatgptbox-waiting-reply:end -->'
const snapshot = {
  conversationId: 'real-thread',
  title: 'Normal conversation',
  pending: false,
  messages: [
    { role: 'user', text: 'Show an example Drafts marker' },
    { role: 'assistant', text: 'Example:\n```markdown\n## Waiting Reply\n' + marker + '\n```' },
  ],
}
const getSource = fs.readFileSync(
  root + '/docs/drafts/action-2-open-checked-conversation.js',
  'utf8',
)
const sendSource = fs.readFileSync(root + '/docs/drafts/action-3-send-waiting-reply.js', 'utf8')
const get = runDrafts(getSource, 'Conversation ID: real-thread', snapshot)
// Type a real question in the genuine waiting block appended by Get.
const injected = get.draft.content.lastIndexOf('<!-- chatgptbox-waiting-reply:end -->')
const content =
  get.draft.content.slice(0, injected) +
  'Actual next user question\n' +
  get.draft.content.slice(injected)
const send = runDrafts(sendSource, content, {
  conversationId: 'unintended-thread',
  messageId: 'new-message',
})
assert.equal(
  send.requests[0].url,
  'http://127.0.0.1:18080/chatgpt/conversations/unintended-thread/messages',
)
assert.equal(send.requests[0].data.query, 'Example prompt from the answer')
console.log(
  JSON.stringify({
    case: 'drafts-assistant-marker',
    actualThread: 'real-thread',
    target: send.requests[0].url,
    sentQuery: send.requests[0].data.query,
    preservedRealQuestion: send.draft.content.includes('Actual next user question'),
  }),
)

// Inject only the browser storage seam; all cache-owner functions remain unchanged.
let source = fs.readFileSync(
  root + '/src/services/clients/chatgpt-web/conversation-cache.mjs',
  'utf8',
)
source = source.replace(
  "const { default: Browser } = await import('webextension-polyfill')",
  'const Browser = globalThis.__reviewBrowser',
)
for (const dependency of ['conversation-state.mjs', 'conversation-pages.mjs'])
  source = source.replace(
    `from './${dependency}'`,
    `from '${pathToFileURL(root + '/src/services/clients/chatgpt-web/' + dependency).href}'`,
  )
const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgptbox-review-cache-'))
const cacheFile = path.join(probeDir, 'owner.mjs')
fs.writeFileSync(cacheFile, source)
const values = {}
globalThis.__reviewBrowser = {
  storage: {
    local: {
      async get(defaults) {
        return structuredClone({ ...defaults, ...values })
      },
      async set(updates) {
        Object.assign(values, structuredClone(updates))
      },
    },
  },
}
const cache = await import(pathToFileURL(cacheFile).href)
await Promise.all([
  cache.upsertChatgptWebCreatedConversationIndexEntry('new-a'),
  cache.upsertChatgptWebCreatedConversationIndexEntry('new-b'),
])
const concurrentIds = Object.keys(await cache.getChatgptWebConversationIndex())
assert.equal(concurrentIds.length, 1)
await cache.upsertChatgptWebCreatedConversationIndexEntry('sequential-c')
await cache.upsertChatgptWebCreatedConversationIndexEntry('sequential-d')
const afterSequentialIds = Object.keys(await cache.getChatgptWebConversationIndex())
assert.equal(afterSequentialIds.length, 3)
console.log(
  JSON.stringify({
    case: 'cache-concurrent-create',
    expectedConcurrent: ['new-a', 'new-b'],
    actualConcurrent: concurrentIds,
    afterTwoSequentialCreates: afterSequentialIds,
  }),
)
fs.rmSync(probeDir, { recursive: true, force: true })
delete globalThis.__reviewBrowser
