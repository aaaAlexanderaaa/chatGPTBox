import { describe, expect, it } from 'vitest'
import {
  collectDecisionStates,
  renderLedgerMarkdown,
} from '../src/background/providers/dsh-bridge.mjs'

// The bridge provider's translation layer (roadmap B): ledger blocks → the
// floating window's port protocol. The pure render/collect functions are
// what keep the bubble stream honest — running tools appear as status
// lines, decisions become cards, history stays out.

describe('renderLedgerMarkdown', () => {
  it('renders text, tool rows, and turn notes in order', () => {
    const blocks = [
      { kind: 'user', text: 'the prompt' },
      { kind: 'text', text: 'Working on it.' },
      { kind: 'tool', name: 'shell', args: 'rm -rf node_modules', status: 'running' },
      { kind: 'tool', name: 'edit_file', args: 'src/config/storage.mjs', status: 'done' },
      { kind: 'text', text: 'Done.' },
      { kind: 'turn-end', note: 'completed · 2 steps' },
    ]
    const markdown = renderLedgerMarkdown(blocks)
    expect(markdown).toContain('Working on it.')
    expect(markdown).toContain('◌ 🔧 shell rm -rf node_modules')
    expect(markdown).toContain('✓ 🔧 edit_file src/config/storage.mjs')
    expect(markdown).toContain('— completed · 2 steps —')
    // user echoes never flow into the answer stream
    expect(markdown).not.toContain('the prompt')
  })

  it('marks errored and cancelled tools differently', () => {
    const markdown = renderLedgerMarkdown([
      { kind: 'tool', name: 'a', args: '', status: 'error' },
      { kind: 'tool', name: 'b', args: '', status: 'cancelled' },
    ])
    expect(markdown).toContain('✗ 🔧 a')
    expect(markdown).toContain('⊘ 🔧 b')
  })

  it('collapses long tool arguments', () => {
    const markdown = renderLedgerMarkdown([
      { kind: 'tool', name: 'write', args: 'x'.repeat(500), status: 'done' },
    ])
    expect(markdown.length).toBeLessThan(200)
    expect(markdown).toContain('…')
  })

  it('returns an empty string for decision-only ledgers', () => {
    expect(renderLedgerMarkdown([{ kind: 'approval', toolName: 'shell', status: 'pending' }])).toBe(
      '',
    )
  })
})

describe('collectDecisionStates', () => {
  it('maps approvals and questions into compact payloads with the session id', () => {
    const decisions = collectDecisionStates(
      [
        {
          kind: 'approval',
          status: 'pending',
          rpcId: 'rpc-1',
          approvalId: 'appr-1',
          toolName: 'shell',
          args: 'npm install',
        },
        {
          kind: 'question',
          status: 'pending',
          rpcId: 'rpc-2',
          questions: [{ id: 'q1', question: 'Which database?' }],
        },
        { kind: 'text', text: 'noise' },
      ],
      'session-9',
    )
    expect(decisions).toEqual([
      {
        kind: 'approval',
        status: 'pending',
        rpcId: 'rpc-1',
        approvalId: 'appr-1',
        toolName: 'shell',
        args: 'npm install',
        questions: null,
        sessionId: 'session-9',
      },
      {
        kind: 'question',
        status: 'pending',
        rpcId: 'rpc-2',
        approvalId: undefined,
        toolName: undefined,
        args: null,
        questions: [{ id: 'q1', question: 'Which database?' }],
        sessionId: 'session-9',
      },
    ])
  })
})
