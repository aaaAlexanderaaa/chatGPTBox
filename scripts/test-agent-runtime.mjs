import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import {
  toToolAlias,
  shouldShortCircuitWithToolLoop,
} from '../src/services/agent/runtime-utils.mjs'
import { AgentProtocol, resolveOpenAiCompatibleProtocol } from '../src/services/agent/protocols.mjs'
import {
  extractTemplateVariables,
  resolvePromptTemplate,
} from '../src/utils/prompt-template-context.mjs'
import { estimateTokenCount } from '../src/utils/token-budget.mjs'
import { parseSkillPackZip } from '../src/services/skills/importer.mjs'
import {
  isDedicatedChatgptProxyTabUrl,
  isLikelyChatgptTabUrl,
} from '../src/utils/chatgpt-proxy-tab.mjs'
import {
  createChatgptWebWebsocketBodyParser,
  createChatgptWebWebsocketRequestController,
} from '../src/services/apis/chatgpt-web-websocket-state.mjs'
import {
  extractChatgptWebConversationListItems,
  extractChatgptWebConversationResult,
  flattenChatgptWebMessageText,
  formatChatgptWebConversationListItem,
  formatChatgptWebConversationSnapshot,
  isPendingChatgptWebConversation,
  isPendingChatgptWebMessageStatus,
  selectChatgptWebRefreshResult,
} from '../src/services/apis/chatgpt-web-conversation-state.mjs'
import {
  findChatgptWebApiThreadContinuation,
  normalizeChatgptWebBridgeMessages,
} from '../src/services/chatgpt-web-thread-state.mjs'

function bufferToArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

function patchCentralDirectoryUncompressedSize(zipBuffer, path, uncompressedSize) {
  const bytes = Buffer.from(zipBuffer)
  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue

    const fileNameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    const fileNameStart = offset + 46
    const fileNameEnd = fileNameStart + fileNameLength
    if (fileNameEnd > bytes.length) {
      throw new Error('Invalid ZIP central directory in test fixture')
    }

    const fileName = bytes.subarray(fileNameStart, fileNameEnd).toString('utf-8')
    if (fileName === path) {
      bytes.writeUInt32LE(uncompressedSize >>> 0, offset + 24)
      return bytes
    }

    offset = fileNameEnd + extraLength + commentLength - 1
  }
  throw new Error(`Failed to locate ZIP path in fixture: ${path}`)
}

async function testAliasUniqueness() {
  const longServer = 'server-with-a-very-long-identifier-that-would-usually-truncate-suffix'
  const longTool = 'tool-with-a-very-long-name-that-would-usually-truncate-suffix-and-collide'
  const aliasA = toToolAlias(longServer, longTool, 1)
  const aliasB = toToolAlias(longServer, longTool, 2)

  assert.notEqual(aliasA, aliasB, 'tool aliases must remain unique after truncation')
  assert.ok(aliasA.length <= 64, 'alias must obey 64-char limit')
  assert.ok(aliasB.length <= 64, 'alias must obey 64-char limit')
  assert.ok(aliasA.endsWith('_1'), 'suffix must be preserved in alias A')
  assert.ok(aliasB.endsWith('_2'), 'suffix must be preserved in alias B')
}

async function testShortCircuitDecision() {
  assert.equal(
    shouldShortCircuitWithToolLoop({ status: 'succeeded', answer: 'done', usedTools: false }),
    true,
  )
  assert.equal(
    shouldShortCircuitWithToolLoop(
      { status: 'succeeded', answer: 'done', usedTools: false },
      { requireToolUse: true },
    ),
    false,
  )
  assert.equal(
    shouldShortCircuitWithToolLoop({ status: 'failed', answer: 'done', usedTools: true }),
    false,
  )
  assert.equal(
    shouldShortCircuitWithToolLoop({ status: 'succeeded', answer: '', usedTools: true }),
    false,
  )
}

async function testProtocolResolver() {
  assert.equal(
    resolveOpenAiCompatibleProtocol('https://api.openai.com/v1', AgentProtocol.auto),
    AgentProtocol.openAiChatCompletionsV1,
  )
  assert.equal(
    resolveOpenAiCompatibleProtocol('https://api.openai.com/v1/responses', AgentProtocol.auto),
    AgentProtocol.openAiResponsesV1,
  )
  assert.equal(
    resolveOpenAiCompatibleProtocol('https://api.openai.com/v1', AgentProtocol.openAiResponsesV1),
    AgentProtocol.openAiResponsesV1,
  )
}

async function testTemplateExpansionAndBudget() {
  const variables = extractTemplateVariables(
    'Analyze {{domTree}} with {{styleSummary}} and {{unknown}}',
  )
  assert.deepEqual(variables, ['domtree', 'stylesummary'])

  const pageContext = {
    url: 'https://example.com',
    domTree: '- body\n  - main\n  - footer',
    styleSummary: 'Fonts: Inter\nColor tokens: #111, #fff',
    content: 'x'.repeat(12000),
  }

  const resolved = resolvePromptTemplate(
    'URL: {{url}}\nDOM:\n{{domTree}}\nStyle:\n{{styleSummary}}',
    {
      pageContext,
      preloadTokenCap: 200,
      contextTokenCap: 260,
    },
  )
  assert.ok(resolved.includes('https://example.com'))
  assert.ok(resolved.includes('DOM:'))

  const budgeted = resolvePromptTemplate('Content:\n{{content}}', {
    pageContext,
    preloadTokenCap: 400,
    contextTokenCap: 1000,
  })
  assert.ok(
    estimateTokenCount(budgeted) <= 1000,
    'resolved template should respect configured context cap',
  )
}

async function testSkillImporterZipParsing() {
  const zipBase64 =
    'UEsDBAoAAAAAAJgIS1w3wN1YhQAAAIUAAAAIABwAU0tJTEwubWRVVAkAAzBli2kwZYtpdXgLAAEE9QEAAAQUAAAALS0tCm5hbWU6IEZyb250ZW5kIENyaXRpYwpkZXNjcmlwdGlvbjogQW5hbHl6ZSBwYWdlIGRlc2lnbgp2ZXJzaW9uOiAxLjAuMAotLS0KVXNlIHRoZSBmb2xsb3dpbmcgY2hlY2tsaXN0LgpTZWUgW3JlZmVyZW5jZV0obm90ZXMubWQpClBLAwQKAAAAAACYCEtcXp6heSIAAAAiAAAACAAcAG5vdGVzLm1kVVQJAAMwZYtpMGWLaXV4CwABBPUBAAAEFAAAAC0gY29sb3IgY29udHJhc3QKLSBzcGFjaW5nIHJoeXRobQpQSwECHgMKAAAAAACYCEtcN8DdWIUAAACFAAAACAAYAAAAAAAAAAAApIEAAAAAU0tJTEwubWRVVAUAAzBli2l1eAsAAQT1AQAABBQAAABQSwECHgMKAAAAAACYCEtcXp6heSIAAAAiAAAACAAYAAAAAAAAAAAApIHHAAAAbm90ZXMubWRVVAUAAzBli2l1eAsAAQT1AQAABBQAAABQSwUGAAAAAAIAAgCcAAAAKwEAAAAA'

  const parsed = await parseSkillPackZip(bufferToArrayBuffer(Buffer.from(zipBase64, 'base64')))
  assert.equal(parsed.metadata.name, 'Frontend Critic')
  assert.equal(parsed.metadata.version, '1.0.0')
  assert.ok(parsed.instructions.includes('checklist'))
  assert.ok(parsed.resources.some((resource) => resource.path === 'notes.md'))

  const oversizedZip = patchCentralDirectoryUncompressedSize(
    Buffer.from(zipBase64, 'base64'),
    'SKILL.md',
    5 * 1024 * 1024,
  )
  await assert.rejects(
    () => parseSkillPackZip(bufferToArrayBuffer(oversizedZip)),
    /exceeds allowed size/,
  )

  await assert.rejects(() => parseSkillPackZip(new ArrayBuffer(16)), /Invalid ZIP|ZIP is empty/)
}

async function testChatgptProxyTabUrlDetection() {
  assert.equal(isLikelyChatgptTabUrl('https://chatgpt.com/'), true)
  assert.equal(isLikelyChatgptTabUrl('https://chatgpt.com/c/abc'), true)
  assert.equal(isLikelyChatgptTabUrl('https://example.com/'), false)

  assert.equal(isDedicatedChatgptProxyTabUrl('https://chatgpt.com/?chatgptbox_proxy=1'), true)
  assert.equal(isDedicatedChatgptProxyTabUrl('https://chatgpt.com/c/abc?chatgptbox_proxy=1'), true)
  assert.equal(isDedicatedChatgptProxyTabUrl('https://chatgpt.com/c/abc'), false)
  assert.equal(
    isDedicatedChatgptProxyTabUrl('https://chatgpt.com/auth/login?chatgptbox_proxy=1'),
    false,
  )
}

async function testChatgptWebBuffersEarlyEventsUntilConversationId() {
  const session = { conversationId: null }
  const received = []
  const failures = []
  let finishCount = 0
  let cleanupCount = 0

  const controller = createChatgptWebWebsocketRequestController({
    session,
    handleMessage: (data) => {
      received.push(data.delta)
    },
    finishMessage: () => {
      finishCount += 1
    },
    failMessage: (error) => {
      failures.push(error)
    },
    cleanup: () => {
      cleanupCount += 1
    },
  })

  assert.equal(
    controller.handleSocketEvent({
      type: 'message',
      conversationId: 'conv-1',
      data: { delta: 'hello' },
    }),
    'buffered',
  )
  assert.equal(
    controller.handleSocketEvent({
      type: 'done',
      conversationId: 'conv-1',
      data: null,
    }),
    'buffered',
  )
  assert.equal(controller.getBufferedCount(), 2)
  assert.deepEqual(controller.confirmDispatch({ conversationId: 'conv-1', wsRequestId: 'ws-1' }), {
    accepted: true,
    bufferedCount: 2,
    settled: true,
  })
  assert.deepEqual(received, ['hello'])
  assert.equal(finishCount, 1)
  assert.equal(cleanupCount, 1)
  assert.equal(failures.length, 0)
  assert.equal(controller.isSettled(), true)
  assert.equal(session.wsRequestId, 'ws-1')
}

async function testChatgptWebIgnoresEventsFromOtherConversations() {
  const session = { conversationId: 'conv-1' }
  const received = []
  let finishCount = 0

  const controller = createChatgptWebWebsocketRequestController({
    session,
    handleMessage: (data) => {
      received.push(data.delta)
    },
    finishMessage: () => {
      finishCount += 1
    },
  })

  assert.equal(
    controller.handleSocketEvent({
      type: 'message',
      conversationId: 'conv-2',
      data: { delta: 'nope' },
    }),
    'ignored',
  )
  assert.equal(
    controller.handleSocketEvent({
      type: 'done',
      conversationId: 'conv-2',
      data: null,
    }),
    'ignored',
  )
  assert.deepEqual(received, [])
  assert.equal(finishCount, 0)
  assert.equal(controller.isSettled(), false)
}

async function testChatgptWebFailsImmediatelyWhenSocketCloses() {
  const session = { conversationId: 'conv-1' }
  const failures = []
  let cleanupCount = 0
  let finishCount = 0

  const controller = createChatgptWebWebsocketRequestController({
    session,
    finishMessage: () => {
      finishCount += 1
    },
    failMessage: (error) => {
      failures.push(error)
    },
    cleanup: () => {
      cleanupCount += 1
    },
  })

  controller.handleSocketEvent({
    type: 'message',
    conversationId: 'conv-1',
    data: { delta: 'partial' },
  })
  controller.handleSocketClose()
  controller.handleSocketClose(new Error('should be ignored'))

  assert.equal(finishCount, 0)
  assert.equal(cleanupCount, 1)
  assert.equal(failures.length, 1)
  assert.match(failures[0].message, /websocket closed/i)
  assert.equal(controller.isSettled(), true)
}

async function testChatgptWebCleanupRunsOnceAfterCompletion() {
  const session = { conversationId: 'conv-1' }
  let cleanupCount = 0

  const controller = createChatgptWebWebsocketRequestController({
    session,
    handleMessage: () => {},
    finishMessage: () => {},
    failMessage: () => {
      throw new Error('should not fail after completion')
    },
    cleanup: () => {
      cleanupCount += 1
    },
  })

  controller.handleSocketEvent({
    type: 'done',
    conversationId: 'conv-1',
    data: null,
  })
  controller.handleSocketClose(new Error('late close'))

  assert.equal(cleanupCount, 1)
  assert.equal(controller.isSettled(), true)
}

async function testChatgptWebDoesNotAdoptLateDispatchAfterFailure() {
  const session = { conversationId: null, wsRequestId: null }
  const controller = createChatgptWebWebsocketRequestController({
    session,
    failMessage: () => {},
  })

  controller.handleSocketClose(new Error('socket closed'))

  assert.deepEqual(
    controller.confirmDispatch({
      conversationId: 'conv-1',
      wsRequestId: 'ws-1',
    }),
    {
      accepted: false,
      bufferedCount: 0,
      settled: true,
    },
  )
  assert.equal(session.conversationId, null)
  assert.equal(session.wsRequestId, null)
}

async function testChatgptWebParsesSplitWebsocketSseChunks() {
  const received = []
  const parseErrors = []
  let doneCount = 0

  const parser = createChatgptWebWebsocketBodyParser({
    handleMessage: (data) => {
      received.push(data.delta)
    },
    handleDone: () => {
      doneCount += 1
    },
    handleParseError: (error) => {
      parseErrors.push(error)
    },
  })

  parser.feed('data: {"delta":"hel')
  parser.feed('lo"}\n\ndata: {"delta":"world"}\n\ndata: [DONE]\n\n')

  assert.deepEqual(received, ['hello', 'world'])
  assert.equal(doneCount, 1)
  assert.deepEqual(parseErrors, [])
}

async function testChatgptWebExtractsFinalConversationResultFromCurrentPath() {
  const result = extractChatgptWebConversationResult(
    {
      current_node: 'assistant-1',
      mapping: {
        'assistant-0': {
          id: 'assistant-0',
          parent: 'root',
          children: ['user-1'],
          message: {
            id: 'assistant-0',
            author: { role: 'assistant' },
            content: { content_type: 'text', parts: ['previous answer'] },
            status: 'finished_successfully',
          },
        },
        'assistant-1': {
          id: 'assistant-1',
          parent: 'user-1',
          children: [],
          message: {
            id: 'assistant-1',
            author: { role: 'assistant' },
            content: { content_type: 'text', parts: ['final answer'] },
            status: 'finished_successfully',
            end_turn: true,
          },
        },
        'user-1': {
          id: 'user-1',
          parent: 'assistant-0',
          children: ['assistant-1'],
          message: {
            id: 'user-1',
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['hello'] },
            status: 'finished_successfully',
          },
        },
        root: {
          id: 'root',
          parent: null,
          children: ['assistant-0'],
          message: null,
        },
      },
    },
    { userMessageId: 'user-1' },
  )

  assert.deepEqual(result, {
    asyncStatus: undefined,
    channel: null,
    contentType: 'text',
    messageId: 'assistant-1',
    pending: false,
    status: 'finished_successfully',
    text: 'final answer',
    isFinal: true,
  })
}

async function testChatgptWebExtractsAssistantDescendantWhenCurrentNodeHasMoved() {
  const result = extractChatgptWebConversationResult(
    {
      current_node: 'user-1',
      mapping: {
        'assistant-2': {
          id: 'assistant-2',
          parent: 'user-1',
          children: [],
          message: {
            id: 'assistant-2',
            author: { role: 'assistant' },
            content: {
              content_type: 'text',
              parts: [{ text: 'segmented ' }, { text: 'answer' }],
            },
            status: 'completed',
          },
        },
        'user-1': {
          id: 'user-1',
          parent: 'assistant-0',
          children: ['assistant-2'],
          message: {
            id: 'user-1',
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['follow up'] },
            status: 'finished_successfully',
          },
        },
        'assistant-0': {
          id: 'assistant-0',
          parent: 'root',
          children: ['user-1'],
          message: {
            id: 'assistant-0',
            author: { role: 'assistant' },
            content: { content_type: 'text', parts: ['older answer'] },
            status: 'finished_successfully',
          },
        },
        root: {
          id: 'root',
          parent: null,
          children: ['assistant-0'],
          message: null,
        },
      },
    },
    { userMessageId: 'user-1' },
  )

  assert.deepEqual(result, {
    asyncStatus: undefined,
    channel: null,
    contentType: 'text',
    messageId: 'assistant-2',
    pending: false,
    status: 'completed',
    text: 'segmented answer',
    isFinal: true,
  })
}

async function testChatgptWebMarksPendingConversationResult() {
  const result = extractChatgptWebConversationResult(
    {
      current_node: 'assistant-pending',
      mapping: {
        'assistant-pending': {
          id: 'assistant-pending',
          parent: 'user-1',
          children: [],
          message: {
            id: 'assistant-pending',
            author: { role: 'assistant' },
            content: { content_type: 'text', parts: ['thinking...'] },
            status: 'in_progress',
          },
        },
        'user-1': {
          id: 'user-1',
          parent: 'root',
          children: ['assistant-pending'],
          message: {
            id: 'user-1',
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['question'] },
            status: 'finished_successfully',
          },
        },
        root: {
          id: 'root',
          parent: null,
          children: ['user-1'],
          message: null,
        },
      },
    },
    { userMessageId: 'user-1' },
  )

  assert.equal(flattenChatgptWebMessageText({ parts: [{ text: 'foo' }, 'bar'] }), 'foobar')
  assert.equal(isPendingChatgptWebMessageStatus(result.status), true)
  assert.equal(result.isFinal, false)
}

async function testChatgptWebPrefersLastNonEmptyAssistantDuringAsyncThinking() {
  const result = extractChatgptWebConversationResult(
    {
      conversation_id: 'conv-1',
      async_status: 3,
      current_node: 'assistant-final',
      mapping: {
        'assistant-final': {
          id: 'assistant-final',
          parent: 'assistant-recap',
          children: [],
          message: {
            id: 'assistant-final',
            author: { role: 'assistant' },
            content: { content_type: 'text', parts: [''] },
            status: 'in_progress',
            channel: 'final',
          },
        },
        'assistant-recap': {
          id: 'assistant-recap',
          parent: 'assistant-commentary',
          children: ['assistant-final'],
          message: {
            id: 'assistant-recap',
            author: { role: 'assistant' },
            content: { content_type: 'reasoning_recap', content: 'Thought for 4m 15s' },
            status: 'finished_successfully',
          },
        },
        'assistant-commentary': {
          id: 'assistant-commentary',
          parent: 'user-1',
          children: ['assistant-recap'],
          message: {
            id: 'assistant-commentary',
            author: { role: 'assistant' },
            content: { content_type: 'text', parts: ['I am still working on it.'] },
            status: 'finished_successfully',
            channel: 'commentary',
          },
        },
        'user-1': {
          id: 'user-1',
          parent: 'root',
          children: ['assistant-commentary'],
          message: {
            id: 'user-1',
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['deep dive into deepseek'] },
            status: 'finished_successfully',
          },
        },
        root: {
          id: 'root',
          parent: null,
          children: ['user-1'],
          message: null,
        },
      },
    },
    { userMessageId: 'user-1', assistantMessageId: 'assistant-final' },
  )

  assert.equal(result.messageId, 'assistant-commentary')
  assert.equal(result.text, 'I am still working on it.')
  assert.equal(result.pending, true)
  assert.equal(result.isFinal, false)
}

async function testChatgptWebConversationFormattingExposesPendingState() {
  const listItem = formatChatgptWebConversationListItem({
    id: 'conv-1',
    title: 'New chat',
    async_status: 2,
    create_time: '2026-03-12T01:45:37.177769Z',
    update_time: '2026-03-12T01:51:59.878181Z',
  })
  assert.equal(listItem.pending, true)
  assert.equal(isPendingChatgptWebConversation({ async_status: 1 }), true)

  const snapshot = formatChatgptWebConversationSnapshot({
    conversation_id: 'conv-1',
    title: 'New chat',
    async_status: null,
    current_node: 'assistant-1',
    mapping: {
      'assistant-1': {
        id: 'assistant-1',
        parent: 'user-1',
        children: [],
        message: {
          id: 'assistant-1',
          author: { role: 'assistant' },
          content: { content_type: 'text', parts: ['done'] },
          status: 'finished_successfully',
          end_turn: true,
        },
      },
      'user-1': {
        id: 'user-1',
        parent: 'root',
        children: ['assistant-1'],
        message: {
          id: 'user-1',
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['hello'] },
          status: 'finished_successfully',
        },
      },
      root: {
        id: 'root',
        parent: null,
        children: ['user-1'],
        message: null,
      },
    },
  })
  assert.equal(snapshot.pending, false)
  assert.equal(snapshot.message.text, 'done')
}

async function testChatgptWebConversationMarksTextFinalWhenAsyncCompletes() {
  const result = extractChatgptWebConversationResult(
    {
      conversation_id: 'conv-1',
      async_status: null,
      current_node: 'assistant-1',
      mapping: {
        'assistant-1': {
          id: 'assistant-1',
          parent: 'user-1',
          children: [],
          message: {
            id: 'assistant-1',
            author: { role: 'assistant' },
            content: { content_type: 'text', parts: ['final answer'] },
            status: 'in_progress',
          },
        },
        'user-1': {
          id: 'user-1',
          parent: 'root',
          children: ['assistant-1'],
          message: {
            id: 'user-1',
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['hello'] },
            status: 'finished_successfully',
          },
        },
        root: {
          id: 'root',
          parent: null,
          children: ['user-1'],
          message: null,
        },
      },
    },
    { userMessageId: 'user-1' },
  )

  assert.equal(result.pending, false)
  assert.equal(result.text, 'final answer')
  assert.equal(result.isFinal, true)
}

async function testChatgptWebConversationListItemExtractionSupportsRawUpstreamShapes() {
  assert.deepEqual(extractChatgptWebConversationListItems([{ id: 'conv-1' }]), [{ id: 'conv-1' }])
  assert.deepEqual(extractChatgptWebConversationListItems({ items: [{ id: 'conv-2' }] }), [
    { id: 'conv-2' },
  ])
  assert.deepEqual(extractChatgptWebConversationListItems({ conversations: [{ id: 'conv-3' }] }), [
    { id: 'conv-3' },
  ])
  assert.deepEqual(extractChatgptWebConversationListItems({ nope: true }), [])
}

async function testChatgptWebApiThreadContinuationUsesLongestPrefix() {
  const match = findChatgptWebApiThreadContinuation(
    [
      {
        model: 'gpt-5-4-thinking',
        conversationId: 'conv-short',
        parentMessageId: 'msg-short',
        transcript: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
        ],
        updatedAt: '2026-03-11T08:00:00.000Z',
      },
      {
        model: 'gpt-5-4-thinking',
        conversationId: 'conv-long',
        parentMessageId: 'msg-long',
        transcript: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
          { role: 'user', content: 'show sources' },
          { role: 'assistant', content: 'here are sources' },
        ],
        updatedAt: '2026-03-11T09:00:00.000Z',
      },
    ],
    {
      model: 'gpt-5-4-thinking',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'show sources' },
        { role: 'assistant', content: 'here are sources' },
        { role: 'user', content: 'go deeper' },
      ],
    },
  )

  assert.equal(match.conversationId, 'conv-long')
  assert.equal(match.parentMessageId, 'msg-long')
  assert.deepEqual(match.nextUserMessage, { role: 'user', content: 'go deeper' })
}

async function testChatgptWebApiThreadContinuationNormalizesMultipartContent() {
  const normalized = normalizeChatgptWebBridgeMessages([
    {
      role: 'user',
      content: [{ type: 'text', text: 'alpha' }, { text: 'beta' }, 'gamma'],
    },
  ])

  assert.deepEqual(normalized, [{ role: 'user', content: 'alpha\nbeta\ngamma' }])
}

async function testChatgptWebApiThreadContinuationRejectsNonUserSuffix() {
  const match = findChatgptWebApiThreadContinuation(
    [
      {
        model: 'gpt-5-4-thinking',
        conversationId: 'conv-1',
        parentMessageId: 'msg-1',
        transcript: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
        ],
        updatedAt: '2026-03-11T08:00:00.000Z',
      },
    ],
    {
      model: 'gpt-5-4-thinking',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'assistant', content: 'duplicate assistant message' },
      ],
    },
  )

  assert.equal(match, null)
}

async function testChatgptWebRefreshPrefersResumeTextForPendingConversation() {
  const selection = selectChatgptWebRefreshResult(
    {
      pending: true,
      message: {
        messageId: 'msg-conversation',
        text: 'I am still working on it.',
      },
    },
    {
      pending: false,
      message: {
        id: 'msg-resume',
        text: 'Final answer from resume',
        isFinal: true,
      },
    },
  )

  assert.deepEqual(selection, {
    text: 'Final answer from resume',
    pending: false,
  })
}

async function run() {
  await testAliasUniqueness()
  await testShortCircuitDecision()
  await testProtocolResolver()
  await testTemplateExpansionAndBudget()
  await testSkillImporterZipParsing()
  await testChatgptProxyTabUrlDetection()
  await testChatgptWebBuffersEarlyEventsUntilConversationId()
  await testChatgptWebIgnoresEventsFromOtherConversations()
  await testChatgptWebFailsImmediatelyWhenSocketCloses()
  await testChatgptWebCleanupRunsOnceAfterCompletion()
  await testChatgptWebDoesNotAdoptLateDispatchAfterFailure()
  await testChatgptWebParsesSplitWebsocketSseChunks()
  await testChatgptWebExtractsFinalConversationResultFromCurrentPath()
  await testChatgptWebExtractsAssistantDescendantWhenCurrentNodeHasMoved()
  await testChatgptWebMarksPendingConversationResult()
  await testChatgptWebPrefersLastNonEmptyAssistantDuringAsyncThinking()
  await testChatgptWebConversationFormattingExposesPendingState()
  await testChatgptWebConversationMarksTextFinalWhenAsyncCompletes()
  await testChatgptWebConversationListItemExtractionSupportsRawUpstreamShapes()
  await testChatgptWebApiThreadContinuationUsesLongestPrefix()
  await testChatgptWebApiThreadContinuationNormalizesMultipartContent()
  await testChatgptWebApiThreadContinuationRejectsNonUserSuffix()
  await testChatgptWebRefreshPrefersResumeTextForPendingConversation()
  console.log('Agent runtime tests passed')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
