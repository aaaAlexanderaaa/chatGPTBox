/* eslint-env node */
import fs from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import postcss from 'postcss'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import {
  decodeChatgptWebGenui,
  renderChatgptWebGenui,
} from '../src/services/clients/chatgpt-web/genui.mjs'
import {
  extractChatgptWebConversationResult,
  extractChatgptWebConversationMessages,
  extractChatgptWebMessageText,
  formatChatgptWebConversationSnapshot,
} from '../src/services/clients/chatgpt-web/conversation-state.mjs'
import { createChatgptWebResumeDeltaAccumulator } from '../src/services/clients/chatgpt-web/resume-delta.mjs'
import { sanitizeMarkdownTree } from '../src/components/MarkdownRender/sanitize-markdown-tree.mjs'

function visualMessage() {
  return {
    id: 'merged',
    author: { role: 'assistant' },
    channel: 'final',
    status: 'finished_successfully',
    end_turn: true,
    content: { content_type: 'text', parts: ['<grid>native content</grid>'] },
    metadata: {
      is_merged_message: true,
      continuation_message_id: 'tail',
      model_dil_v2: {
        code: 'DIL.render(__dil.jsx(()=>{const __dilConstants=DIL.useConstants();return __dil.jsx(__dil.Fragment,null,__dil.jsx("grid",{columns:2,gap:3},__dil.jsx("box",{border:true,padding:3},__dil.jsx("title",{size:"2xl"},__dilConstants["0"])),__dil.jsx("box",null,__dil.jsx("text",null,__dilConstants["1"]))),__dil.jsx("table",null,__dil.jsx("table-row",null,__dil.jsx("table-cell",null,"Last event"))),__dilSafe(()=>__dil.jsx(Cite,{__resolutionId:"source"}),null));}));',
        constants: { 0: 'Metric', 1: '<script>alert(1)</script>' },
        appData: {
          opGenui: {
            componentResults: {
              source: {
                safe_urls: ['https://example.com/news'],
                state: {
                  items: [
                    {
                      url: 'https://example.com/news',
                      source_label: 'Example',
                      ref_id: 'turn1search0',
                    },
                    { url: 'javascript:alert(1)', source_label: 'Unsafe' },
                    { url: 'https://unapproved.example', source_label: 'Unapproved' },
                  ],
                },
              },
            },
          },
        },
      },
    },
  }
}

function conversationWithVisibleFragment() {
  const merged = visualMessage()
  merged.create_time = 10
  merged.metadata.model_dil_v2.code = 'DIL.render(__dil.jsx("chart",null));'
  merged.metadata.model_dil_v2.fallbackMarkdown = 'Complete merged answer'
  return {
    conversation_id: 'conversation',
    current_node: 'tail',
    async_status: null,
    mapping: {
      user: {
        id: 'user',
        parent: null,
        children: ['merged'],
        message: {
          id: 'user',
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['News visualization'] },
        },
      },
      merged: { id: 'merged', parent: 'user', children: ['tail'], message: merged },
      tail: {
        id: 'tail',
        parent: 'merged',
        children: [],
        message: {
          ...merged,
          id: 'tail',
          create_time: 11,
          end_turn: false,
          metadata: { is_message_fragment: true },
          content: { content_type: 'text', parts: ['Fragment '.repeat(500)] },
        },
      },
    },
  }
}

describe('GPT-6 native visualization', () => {
  it.each(['same turn', 'later turn', 'sibling branch', 'completed anchor', 'pending successor'])(
    'replaces a recovery anchor only with a completed answer on the same path (%s)',
    (scenario) => {
      const conversation = conversationWithVisibleFragment()
      const mapping = conversation.mapping
      mapping.user.children = ['commentary']
      mapping.merged.parent = 'commentary'
      mapping.commentary = {
        id: 'commentary',
        parent: 'user',
        children: ['merged'],
        message: {
          id: 'commentary',
          author: { role: 'assistant' },
          channel: 'commentary',
          status: 'finished_successfully',
          end_turn: false,
          content: { content_type: 'text', parts: ['Gathering the news'] },
        },
      }
      if (scenario === 'later turn') {
        mapping.nextUser = {
          id: 'nextUser',
          parent: 'commentary',
          children: ['merged'],
          message: { ...mapping.user.message, id: 'nextUser' },
        }
        mapping.commentary.children = ['nextUser']
        mapping.merged.parent = 'nextUser'
      } else if (scenario === 'sibling branch') {
        mapping.active = {
          id: 'active',
          parent: 'commentary',
          children: [],
          message: { ...mapping.commentary.message, id: 'active' },
        }
        mapping.commentary.children.push('active')
        conversation.current_node = 'active'
      } else if (scenario === 'completed anchor') {
        mapping.commentary.message.end_turn = true
      } else if (scenario === 'pending successor') {
        mapping.merged.message.end_turn = false
        mapping.merged.message.status = 'in_progress'
      }
      const result = extractChatgptWebConversationResult(conversation, {
        userMessageId: 'user',
        assistantMessageId: 'commentary',
      })
      expect(result.messageId).toBe(scenario === 'same turn' ? 'merged' : 'commentary')
      expect(result.isFinal).toBe(['same turn', 'completed anchor'].includes(scenario))
    },
  )

  it('preserves cards, table contents and resolved citations as portable HTML', () => {
    const html = renderChatgptWebGenui(visualMessage())
    expect(html).toContain('chatgptbox-genui-grid')
    expect(html).toContain('grid-template-columns:repeat(2,minmax(0,1fr))')
    expect(html).toContain('Last event')
    expect(html).toContain('href="https://example.com/news"')
    expect(html).not.toContain('Unapproved')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('DIL.render')
  })

  it('never runs generated code or hooks and rejects arbitrary expressions', () => {
    const message = visualMessage()
    message.metadata.model_dil_v2.code =
      'globalThis.genuiExecuted=true;DIL.render(__dil.jsx("text",null,fetch("https://example.com")));'
    expect(decodeChatgptWebGenui(message.metadata.model_dil_v2)).toBeNull()
    expect(globalThis.genuiExecuted).toBeUndefined()
    message.metadata.model_dil_v2.fallbackMarkdown = 'Readable fallback citeturn1search0'
    expect(renderChatgptWebGenui(message)).toContain('[Example](https://example.com/news)')
  })

  it.each([
    ['object constant', '__dilConstants["0"]', { label: 'Metric' }],
    ['object literal', '{label:"Metric"}', null],
    [
      'unsupported constant component',
      '__dilConstants["0"]',
      { tag: 'chart', props: {}, children: ['Data'] },
    ],
    [
      'forged constant tag',
      '__dilConstants["0"]',
      { tag: 'x"><script>alert(1)</script><span class="', props: {}, children: [] },
    ],
  ])('uses the cited Markdown fallback for a non-renderable %s', (_, child, constant) => {
    const message = visualMessage()
    const dil = message.metadata.model_dil_v2
    dil.code = `DIL.render(__dil.jsx("text",null,${child}));`
    dil.constants = { 0: constant }
    dil.fallbackMarkdown = 'Readable fallback citeturn1search0'
    const expected = 'Readable fallback [Example](https://example.com/news)'
    expect(renderChatgptWebGenui(message)).toBe(expected)
    expect(extractChatgptWebMessageText(message)).toBe(expected)

    delete dil.fallbackMarkdown
    expect(renderChatgptWebGenui(message)).toBeNull()
    expect(extractChatgptWebMessageText(message)).toBe('<grid>native content</grid>')
  })

  it.each([false, true])(
    'preserves fallback content references alongside component citations (%s)',
    (withComponentCitations) => {
      const message = visualMessage()
      const dil = message.metadata.model_dil_v2
      const token = 'citeturn1search1'
      dil.code = 'DIL.render(__dil.jsx("chart",null));'
      dil.fallbackMarkdown = `Readable fallback ${token} citeunknown`
      if (withComponentCitations) dil.fallbackMarkdown += ' citeturn1search0'
      else delete dil.appData
      message.metadata.content_references = [
        {
          type: 'grouped_webpages',
          matched_text: token,
          start_idx: 18,
          end_idx: 18 + token.length,
          items: [
            { url: 'https://example.com/report', title: 'Report', attribution: 'Report source' },
          ],
        },
      ]
      const rendered = renderChatgptWebGenui(message)
      expect(rendered).toContain('[Report source][1]')
      expect(rendered).toContain('[1]: <https://example.com/report> "Report"')
      expect(rendered).not.toContain('cite')
      if (withComponentCitations) expect(rendered).toContain('[Example](https://example.com/news)')
      expect(extractChatgptWebMessageText(message)).toBe(rendered)

      const conversation = conversationWithVisibleFragment()
      conversation.mapping.merged.message = message
      expect(formatChatgptWebConversationSnapshot(conversation).messages[1].text).toBe(rendered)
      const accumulator = createChatgptWebResumeDeltaAccumulator()
      accumulator.feedEvent('', { message })
      accumulator.markAuthoritativeDone()
      expect(accumulator.getResult().bestMessage.text).toBe(rendered)
    },
  )

  it.each([false, true])(
    'preserves the default grid layout after Markdown sanitization (KaTeX: %s)',
    (allowKatexStyles) => {
      const message = visualMessage()
      message.metadata.model_dil_v2.code =
        'DIL.render(__dil.jsx("grid",null,__dil.jsx("box",null,"One"),__dil.jsx("box",null,"Two")));'
      const processor = unified()
        .use(remarkParse)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw)
        .use(sanitizeMarkdownTree, { allowKatexStyles })
      const tree = processor.runSync(processor.parse(renderChatgptWebGenui(message)))
      const grid = tree.children[0].children[0]
      expect(grid.properties.style).toBeUndefined()
      expect(grid.properties.className).toContain('chatgptbox-genui-columns-2')
      expect(grid.children.map((node) => node.children[0].value)).toEqual(['One', 'Two'])

      const stylesheet = postcss.parse(
        fs.readFileSync(new URL('../src/components/MarkdownRender/genui.css', import.meta.url)),
      )
      const rule = stylesheet.nodes.find((node) => node.selector === '.chatgptbox-genui-columns-2')
      expect(rule.nodes.find((node) => node.prop === 'grid-template-columns').value).toBe(
        'repeat(2, minmax(0, 1fr))',
      )
    },
  )

  it('keeps fragment-only turns out of the transcript until a merged answer arrives', () => {
    const conversation = conversationWithVisibleFragment()
    const snapshot = formatChatgptWebConversationSnapshot(conversation)
    expect(snapshot.message).toMatchObject({ messageId: 'merged', isFinal: true })
    expect(snapshot.messages.map((message) => message.messageId)).toEqual(['user', 'merged'])
    expect(snapshot.messages[1]).toMatchObject({ text: 'Complete merged answer', isFinal: true })

    conversation.mapping.user.children = ['tail']
    conversation.mapping.tail.parent = 'user'
    delete conversation.mapping.merged
    const partial = formatChatgptWebConversationSnapshot(conversation)
    expect(partial.message).toBeNull()
    expect(partial.messages.map((message) => message.messageId)).toEqual(['user'])
  })

  it('does not treat a finished fragment as the end of the turn', () => {
    const accumulator = createChatgptWebResumeDeltaAccumulator()
    accumulator.feedEvent('', { message: { ...visualMessage(), metadata: {}, end_turn: false } })
    accumulator.markAuthoritativeDone()
    expect(accumulator.getResult().completed).toBe(false)
    accumulator.feedEvent('', { message: visualMessage() })
    expect(accumulator.getResult().completed).toBe(true)
  })

  it('keeps the full merged answer when the final stream event is a hidden continuation', () => {
    const accumulator = createChatgptWebResumeDeltaAccumulator()
    accumulator.feedEvent('', { message: visualMessage() })
    accumulator.feedEvent('', {
      message: {
        ...visualMessage(),
        id: 'tail',
        metadata: { is_message_fragment: true, is_visually_hidden_from_conversation: true },
        content: { content_type: 'text', parts: ['Only the tail'] },
      },
    })
    accumulator.markAuthoritativeDone()
    expect(accumulator.getResult().bestMessage.id).toBe('merged')
    expect(accumulator.getResult().bestMessage.text).toContain('Metric')
    expect(accumulator.getResult().bestMessage.text).toContain('Last event')
  })

  it('ignores a hidden anchor in polled history and exposes continuation and completion facts', () => {
    const visible = visualMessage()
    const conversation = {
      conversation_id: 'conversation',
      current_node: 'tail',
      async_status: null,
      mapping: {
        user: {
          id: 'user',
          parent: null,
          children: ['merged'],
          message: {
            id: 'user',
            author: { role: 'user' },
            content: { content_type: 'text', parts: ['News visualization'] },
          },
        },
        merged: { id: 'merged', parent: 'user', children: ['tail'], message: visible },
        tail: {
          id: 'tail',
          parent: 'merged',
          children: [],
          message: {
            ...visible,
            id: 'tail',
            metadata: { is_message_fragment: true, is_visually_hidden_from_conversation: true },
          },
        },
      },
    }
    const result = extractChatgptWebConversationResult(conversation, {
      userMessageId: 'user',
      assistantMessageId: 'tail',
    })
    expect(result).toMatchObject({
      messageId: 'merged',
      continuationMessageId: 'tail',
      isFinal: true,
    })
    const snapshot = formatChatgptWebConversationSnapshot(conversation)
    expect(snapshot.messages).toHaveLength(2)
    expect(snapshot.messages[1]).toMatchObject({ isFinal: true, endTurn: true })
    visible.end_turn = false
    expect(extractChatgptWebConversationResult(conversation).isFinal).toBe(false)
  })

  for (const file of ['action-2-open-checked-conversation.js', 'action-3-send-waiting-reply.js']) {
    it.each([
      ['idle snapshot', null, undefined, undefined, true],
      ['active snapshot', 'IS_STREAMING', undefined, undefined, false],
      ['missing completion evidence', undefined, undefined, undefined, false],
      ['explicit nonterminal answer', null, 'finished_successfully', false, false],
      ['pending answer', null, 'in_progress', undefined, false],
    ])(
      `uses consistent completion facts for %s (${file})`,
      (_, asyncStatus, status, endTurn, isFinal) => {
        const conversation = conversationWithVisibleFragment()
        const message = conversation.mapping.merged.message
        delete message.status
        delete message.end_turn
        if (status !== undefined) message.status = status
        if (endTurn !== undefined) message.end_turn = endTurn
        if (asyncStatus === undefined) delete conversation.async_status
        else conversation.async_status = asyncStatus
        const payload = formatChatgptWebConversationSnapshot(conversation)
        expect(payload.message.isFinal).toBe(isFinal)
        expect(payload.messages[1].isFinal).toBe(isFinal)
        expect(extractChatgptWebConversationMessages(conversation)[1].isFinal).toBe(isFinal)
        const draft = {
          content:
            'Conversation ID: conversation\n### USER\n\nNews visualization\n\n### ASSISTANT (pending)\n\n<!-- chatgptbox-waiting-reply:start {"conversationId":"conversation","pendingMessageId":"user"} -->\n<!-- chatgptbox-waiting-reply:end -->',
          update() {},
        }
        vm.runInNewContext(
          fs.readFileSync(new URL('../docs/drafts/' + file, import.meta.url), 'utf8'),
          {
            draft,
            app: { displayErrorMessage() {}, displaySuccessMessage() {} },
            HTTP: {
              create: () => ({
                request: () => ({ success: true, statusCode: 200, responseData: payload }),
              }),
            },
          },
        )
        expect(draft.content.includes('Status: complete')).toBe(isFinal)
        expect(draft.content.includes('"pendingMessageId":"user"')).toBe(!isFinal)
      },
    )

    it(`clears the Drafts pending anchor once the merged answer is complete (${file})`, () => {
      const source = fs.readFileSync(new URL('../docs/drafts/' + file, import.meta.url), 'utf8')
      const draft = {
        content:
          'Conversation ID: conversation\n### USER\n\nNews visualization\n\n### ASSISTANT (pending)\n\n<!-- chatgptbox-waiting-reply:start {"conversationId":"conversation","pendingMessageId":"user"} -->\n<!-- chatgptbox-waiting-reply:end -->',
        update() {},
      }
      const payload = formatChatgptWebConversationSnapshot(conversationWithVisibleFragment())
      vm.runInNewContext(source, {
        draft,
        app: { displayErrorMessage() {}, displaySuccessMessage() {} },
        HTTP: {
          create: () => ({
            request: () => ({ success: true, statusCode: 200, responseData: payload }),
          }),
        },
      })
      expect(draft.content).toContain('Status: complete')
      expect(draft.content).toContain('Complete merged answer')
      expect(draft.content).not.toContain('Fragment ')
      expect(draft.content).not.toContain('"pendingMessageId":"user"')
    })

    it(`keeps the Drafts pending anchor on a nonterminal fragment (${file})`, () => {
      const source = fs.readFileSync(new URL('../docs/drafts/' + file, import.meta.url), 'utf8')
      const draft = {
        content:
          'Conversation ID: conversation\n### USER\n\nNews visualization\n\n### ASSISTANT (pending)\n\n<!-- chatgptbox-waiting-reply:start {"conversationId":"conversation","pendingMessageId":"user"} -->\n<!-- chatgptbox-waiting-reply:end -->',
        update() {},
      }
      const payload = {
        conversationId: 'conversation',
        pending: false,
        messages: [
          { role: 'user', messageId: 'user', text: 'News visualization' },
          {
            role: 'assistant',
            text: 'Partial card',
            status: 'finished_successfully',
            endTurn: false,
            isFinal: false,
          },
        ],
        message: { text: 'Partial card', status: 'finished_successfully', isFinal: false },
      }
      vm.runInNewContext(source, {
        draft,
        app: { displayErrorMessage() {}, displaySuccessMessage() {} },
        HTTP: {
          create: () => ({
            request: () => ({ success: true, statusCode: 200, responseData: payload }),
          }),
        },
      })
      expect(draft.content).toContain('Status: pending')
      expect(draft.content).toContain('"pendingMessageId":"user"')
    })
  }
})
