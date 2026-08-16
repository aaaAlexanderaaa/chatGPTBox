import { describe, expect, it } from 'vitest'
import {
  captureLedgerBaseline,
  collectDecisionStates,
  ledgerSliceForPrompt,
  renderLedgerMarkdown,
  shouldFinishFromLedger,
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
        { kind: 'tool', callId: 'call-1', name: 'shell', args: 'npm install', status: 'running' },
        {
          kind: 'approval',
          status: 'pending',
          rpcId: 'rpc-1',
          approvalId: 'appr-1',
          callId: 'call-1',
          toolName: 'shell',
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

describe('bridge turn baseline', () => {
  it('finishes when a turn-end arrives after this prompt’s user echo', () => {
    const before = [
      { kind: 'text', text: 'old' },
      { kind: 'turn-end', note: 'previous' },
    ]
    const baseline = captureLedgerBaseline(before)
    expect(shouldFinishFromLedger(before, baseline)).toBe(false)

    const duringRpc = [
      ...before,
      { kind: 'user', text: 'the question' },
      { kind: 'text', text: 'new answer' },
      { kind: 'turn-end', note: 'this prompt' },
    ]
    expect(shouldFinishFromLedger(duringRpc, baseline)).toBe(true)
  })

  it('does not finish on ledger that only grew with non-end blocks', () => {
    const baseline = captureLedgerBaseline([{ kind: 'text', text: 'hi' }])
    expect(
      shouldFinishFromLedger(
        [
          { kind: 'text', text: 'hi' },
          { kind: 'user', text: 'q' },
          { kind: 'text', text: 'more' },
        ],
        baseline,
      ),
    ).toBe(false)
  })

  it('does not finish when a previous in-flight turn ends after the snapshot', () => {
    const before = [{ kind: 'text', text: 'still running' }]
    const baseline = captureLedgerBaseline(before)
    const previousEnded = [
      ...before,
      { kind: 'text', text: 'leftover' },
      { kind: 'turn-end', note: 'the other turn' },
    ]
    expect(shouldFinishFromLedger(previousEnded, baseline)).toBe(false)
    expect(ledgerSliceForPrompt(previousEnded, baseline)).toEqual([])

    const ours = [
      ...previousEnded,
      { kind: 'user', text: 'queued from the bubble' },
      { kind: 'text', text: 'our answer' },
      { kind: 'turn-end', note: 'ours' },
    ]
    expect(shouldFinishFromLedger(ours, baseline)).toBe(true)
    expect(ledgerSliceForPrompt(ours, baseline).map((block) => block.kind)).toEqual([
      'text',
      'turn-end',
    ])
  })

  it('ignores a previous turn that ends after this prompt’s user echo was queued', () => {
    const before = [{ kind: 'text', text: 'still running', turn: 1 }]
    const baseline = captureLedgerBaseline(before)
    const queuedThenPreviousEnded = [
      ...before,
      { kind: 'user', text: 'queued from the bubble', turn: 2 },
      { kind: 'text', text: 'leftover', turn: 1 },
      { kind: 'turn-end', note: 'the other turn', turn: 1 },
    ]
    expect(shouldFinishFromLedger(queuedThenPreviousEnded, baseline)).toBe(false)
    expect(
      ledgerSliceForPrompt(queuedThenPreviousEnded, baseline).map((block) => block.kind),
    ).toEqual([])

    const ours = [
      ...queuedThenPreviousEnded,
      { kind: 'text', text: 'our answer', turn: 2 },
      { kind: 'turn-end', note: 'ours', turn: 2 },
    ]
    expect(shouldFinishFromLedger(ours, baseline)).toBe(true)
    expect(ledgerSliceForPrompt(ours, baseline).map((block) => block.kind)).toEqual([
      'text',
      'turn-end',
    ])
  })

  it('does not finish on a previous turn-end when the user echo has no turn number', () => {
    const before = [{ kind: 'text', text: 'still running', turn: 1 }]
    const baseline = captureLedgerBaseline(before)
    const queuedThenPreviousEnded = [
      ...before,
      { kind: 'user', text: 'queued from the bubble' },
      { kind: 'text', text: 'leftover', turn: 1 },
      { kind: 'turn-end', note: 'the other turn', turn: 1 },
    ]
    expect(shouldFinishFromLedger(queuedThenPreviousEnded, baseline)).toBe(false)
    expect(ledgerSliceForPrompt(queuedThenPreviousEnded, baseline)).toEqual([])

    const ours = [
      ...queuedThenPreviousEnded,
      { kind: 'text', text: 'our answer', turn: 2 },
      { kind: 'turn-end', note: 'ours', turn: 2 },
    ]
    expect(shouldFinishFromLedger(ours, baseline)).toBe(true)
    expect(ledgerSliceForPrompt(ours, baseline).map((block) => block.kind)).toEqual([
      'text',
      'turn-end',
    ])
  })
})
