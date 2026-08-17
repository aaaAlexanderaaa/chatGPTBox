/* eslint-env node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildQuestionAnswers,
  cockpitHrefForSession,
  decisionsAfterRespond,
} from '../src/components/ConversationCard/dsh-decision-state.mjs'
import { waitingNotificationAction } from '../src/modules/dsh/background/waiting-inbox.mjs'
import {
  canSelectCockpitSession,
  cockpitUrlForSession,
  pickCockpitSessionId,
  resolveCockpitSelection,
} from '../src/modules/dsh/session-pick.mjs'
import { createPortReconnect } from '../src/modules/dsh/ui/port-reconnect.mjs'
import { modelChipLabel, selectModelArgs } from '../src/modules/dsh/ui/select-model.mjs'

describe('decisionsAfterRespond', () => {
  const pending = {
    kind: 'approval',
    approvalId: 'ap1',
    rpcId: 'rpc-1',
    status: 'pending',
  }

  it('collapses an approval only when the harness accepted the answer', () => {
    expect(decisionsAfterRespond([pending], pending, { accepted: true })).toEqual([])
  })

  it('collapses a question the same way after a successful dismiss', () => {
    const question = { kind: 'question', rpcId: 'rpc-q', status: 'pending' }
    expect(decisionsAfterRespond([question], question, { accepted: true })).toEqual([])
    expect(decisionsAfterRespond([question], question, { accepted: false })).toEqual([question])
  })

  it('keeps the card when the answer was late or the transport failed', () => {
    expect(decisionsAfterRespond([pending], pending, { accepted: false })).toEqual([pending])
    expect(decisionsAfterRespond([pending], pending, undefined)).toEqual([pending])
  })
})

describe('pickCockpitSessionId', () => {
  const sessions = [
    { sessionId: 'idle', waiting: 0, blank: false, updatedAt: 1 },
    { sessionId: 'waiting', waiting: 2, blank: false, updatedAt: 2 },
    { sessionId: 'blank', waiting: 0, blank: true, updatedAt: 3 },
  ]

  it('honors an explicit session query when that row exists', () => {
    expect(pickCockpitSessionId(sessions, 'idle')).toBe('idle')
  })

  it('falls through to a waiting session, then the first non-blank', () => {
    expect(pickCockpitSessionId(sessions, 'missing')).toBe('waiting')
    expect(
      pickCockpitSessionId(
        sessions.filter((s) => s.waiting === 0),
        null,
      ),
    ).toBe('idle')
  })

  it('does not treat engine-native search hits as selectable cockpit rows (D-4)', () => {
    expect(canSelectCockpitSession(sessions, 'idle')).toBe(true)
    expect(canSelectCockpitSession(sessions, 'foreign-from-search')).toBe(false)
  })
})

describe('resolveCockpitSelection', () => {
  const idle = { sessionId: 'idle', waiting: 0, blank: false }
  const waiting = { sessionId: 'waiting', waiting: 2, blank: false }
  const target = { sessionId: 'from-notification', waiting: 1, blank: false }

  it('switches to a requested session that arrives after a fallback pick', () => {
    expect(
      resolveCockpitSelection({
        sessions: [idle, waiting],
        requestedId: 'from-notification',
        currentId: 'waiting',
        userPicked: false,
      }),
    ).toBe('waiting')
    expect(
      resolveCockpitSelection({
        sessions: [idle, waiting, target],
        requestedId: 'from-notification',
        currentId: 'waiting',
        userPicked: false,
      }),
    ).toBe('from-notification')
  })

  it('does not steal the row after the user picked a different session', () => {
    expect(
      resolveCockpitSelection({
        sessions: [idle, waiting, target],
        requestedId: 'from-notification',
        currentId: 'idle',
        userPicked: true,
      }),
    ).toBe('idle')
  })
})

describe('cockpitUrlForSession', () => {
  it('appends the session query onto the cockpit page', () => {
    expect(cockpitUrlForSession('chrome-extension://id/dsh.html', 'abc')).toBe(
      'chrome-extension://id/dsh.html?session=abc',
    )
    expect(cockpitUrlForSession('chrome-extension://id/dsh.html', null)).toBe(
      'chrome-extension://id/dsh.html',
    )
  })
})

describe('createPortReconnect', () => {
  it('does not reconnect after stop, even if disconnect already scheduled a retry', () => {
    const connects = []
    const timers = []
    const life = createPortReconnect({
      connect: () => connects.push('c'),
      delayMs: 1000,
      setTimeoutFn: (fn) => {
        timers.push(fn)
        return timers.length
      },
      clearTimeoutFn: () => {},
    })
    life.start()
    expect(connects).toHaveLength(1)
    life.onDisconnect()
    life.stop()
    timers.forEach((fn) => fn())
    expect(connects).toHaveLength(1)
  })

  it('reconnects after disconnect while still active', () => {
    const connects = []
    const timers = []
    const life = createPortReconnect({
      connect: () => connects.push('c'),
      delayMs: 1000,
      setTimeoutFn: (fn) => {
        timers.push(fn)
        return timers.length
      },
      clearTimeoutFn: () => {},
    })
    life.start()
    life.onDisconnect()
    timers.forEach((fn) => fn())
    expect(connects).toHaveLength(2)
  })
})

describe('selectModelArgs', () => {
  it('uses the option provider, not the currently selected provider', () => {
    expect(selectModelArgs('s1', { id: 'gpt-4.1', provider: 'openai' }, 'deepseek')).toEqual({
      sessionId: 's1',
      provider: 'openai',
      model: 'gpt-4.1',
    })
    expect(selectModelArgs('s1', { id: 'chat' }, 'deepseek')).toEqual({
      sessionId: 's1',
      provider: 'deepseek',
      model: 'chat',
    })
  })
})

describe('waitingNotificationAction', () => {
  it('clears the OS notification only when nothing is waiting anywhere', () => {
    expect(waitingNotificationAction({ sessionPending: 0, totalPending: 0, attached: false })).toBe(
      'clear',
    )
  })

  it('does not clear when this session is idle but another session is still waiting', () => {
    expect(waitingNotificationAction({ sessionPending: 0, totalPending: 2, attached: false })).toBe(
      'notify-other',
    )
  })

  it('notifies for this session when it has pending work and no UI is attached', () => {
    expect(waitingNotificationAction({ sessionPending: 1, totalPending: 1, attached: false })).toBe(
      'notify',
    )
  })

  it('stays quiet when a UI surface is already looking at this session', () => {
    expect(waitingNotificationAction({ sessionPending: 1, totalPending: 1, attached: true })).toBe(
      'none',
    )
  })
})

describe('held gateway ports', () => {
  it('builds the hello from resolveGatewayHoldReason, not a hardcoded module-off string', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/background-services.mjs'),
      'utf8',
    )
    expect(src).toMatch(/helloForGatewayHold/)
    expect(src).toMatch(/resolveGatewayHoldReason/)
  })
})

describe('popup gateway reconnect', () => {
  it('does not treat module-off as a terminal disconnect', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/popup/ChatPanel.jsx'), 'utf8')
    expect(src).not.toMatch(/lastStatus === ['"]disabled['"]/)
  })
})

describe('createPortReconnect shouldRetry', () => {
  it('skips the scheduled reconnect when shouldRetry returns false', () => {
    const connects = []
    const timers = []
    const life = createPortReconnect({
      connect: () => connects.push('c'),
      shouldRetry: () => false,
      delayMs: 1000,
      setTimeoutFn: (fn) => {
        timers.push(fn)
        return timers.length
      },
      clearTimeoutFn: () => {},
    })
    life.start()
    life.onDisconnect()
    timers.forEach((fn) => fn())
    expect(connects).toHaveLength(1)
  })
})

describe('modelChipLabel', () => {
  it('keeps a just-selected model visible after the menu closes', () => {
    expect(modelChipLabel(null, { provider: 'openai', id: 'gpt-4.1' })).toBe('openai/gpt-4.1')
    expect(modelChipLabel({ current: { provider: 'deepseek', model: 'chat' } }, null)).toBe(
      'deepseek/chat',
    )
    expect(modelChipLabel(null, null)).toBe('model')
  })
})

describe('buildQuestionAnswers', () => {
  it('keeps a separate free-text draft per question id', () => {
    const questions = [
      { id: 'q1', question: 'Name?' },
      { id: 'q2', question: 'Repo?' },
    ]
    expect(buildQuestionAnswers(questions, {}, { q1: 'Ada', q2: 'box' })).toEqual([
      { id: 'q1', selected: [], custom: 'Ada' },
      { id: 'q2', selected: [], custom: 'box' },
    ])
  })
})

describe('cockpitHrefForSession', () => {
  it('is the core twin of cockpitUrlForSession so popup/floating cards can deep-link', () => {
    expect(cockpitHrefForSession('chrome-extension://id/dsh.html', 'abc')).toBe(
      cockpitUrlForSession('chrome-extension://id/dsh.html', 'abc'),
    )
  })
})

describe('IndependentPanel drafts', () => {
  it('passes a per-session draftKey into ConversationCard', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/pages/IndependentPanel/App.jsx'),
      'utf8',
    )
    expect(src).toMatch(/draftKey=\{/)
  })
})

describe('harness session query', () => {
  it('uses resolveCockpitSelection so a late ?session= can still win', () => {
    const src = readFileSync(path.resolve(process.cwd(), 'src/modules/dsh/ui/app.jsx'), 'utf8')
    expect(src).toMatch(/resolveCockpitSelection/)
  })
})

describe('en locale covers dsh surface copy', () => {
  it('has the decision-card keys without cockpit product names', () => {
    const en = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'src/_locales/en/main.json'), 'utf8'),
    )
    for (const key of [
      'ChatGPT Web keeps the conversation server-side',
      'The agent is waiting for you',
      'Selection attached',
      'Open DeepSeek Harness',
      'Answer in DeepSeek Harness',
    ]) {
      expect(en[key]).toBe(key)
    }
  })
})

const COCKPIT_IDENTIFIER_RE =
  /\b(cockpitHref|cockpitUrl|Cockpit\.jsx|resolveCockpitSelection|pickCockpitSessionId|canSelectCockpitSession|cockpitHrefForSession)\b/g

function stripCommentLines(src) {
  return src
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return !trimmed.startsWith('//') && !trimmed.startsWith('*')
    })
    .join('\n')
}

function userVisibleCopyFromSource(src) {
  const cleaned = stripCommentLines(src).replace(COCKPIT_IDENTIFIER_RE, '')
  const strings = []
  for (const match of cleaned.matchAll(/title="([^"]*)"/g)) strings.push(match[1])
  for (const match of cleaned.matchAll(/t\(['"]([^'"]*)['"]\)/g)) strings.push(match[1])
  for (const match of cleaned.matchAll(/>\s*([^<{}\n]+?)\s*</g)) {
    const text = match[1].trim()
    if (text && !/[=({]/.test(text)) strings.push(text)
  }
  return strings.filter(Boolean)
}

describe('no cockpit product copy', () => {
  it('en and zh-hans user strings do not say cockpit or 驾驶舱', () => {
    for (const rel of ['src/_locales/en/main.json', 'src/_locales/zh-hans/main.json']) {
      const table = JSON.parse(readFileSync(path.resolve(process.cwd(), rel), 'utf8'))
      for (const [key, value] of Object.entries(table)) {
        const blob = `${key}\n${value}`
        expect(blob).not.toMatch(/cockpit/i)
        expect(blob).not.toMatch(/驾驶舱/)
      }
    }
  })

  it('full-page tooltips do not say cockpit', () => {
    for (const rel of [
      'src/modules/dsh/ui/app.jsx',
      'src/modules/dsh/ui/shell/Header.jsx',
      'src/modules/dsh/ui/shell/Sidebar.jsx',
      'src/modules/dsh/ui/shell/SessionHeader.jsx',
    ]) {
      const src = readFileSync(path.resolve(process.cwd(), rel), 'utf8')
      const titles = [...src.matchAll(/title="([^"]*)"/g)].map((m) => m[1])
      for (const title of titles) {
        expect(title).not.toMatch(/cockpit/i)
        expect(title).not.toMatch(/驾驶舱/)
      }
    }
  })

  it('dsh UI sources do not expose cockpit or 驾驶舱 in user-visible copy', () => {
    for (const rel of [
      'src/modules/dsh/ui/app.jsx',
      'src/modules/dsh/ui/shell/Header.jsx',
      'src/modules/dsh/ui/shell/Sidebar.jsx',
      'src/modules/dsh/ui/shell/SessionHeader.jsx',
      'src/popup/ChatPanel.jsx',
      'src/modules/dsh/ui/SettingsCard.jsx',
      'src/components/ConversationCard/index.jsx',
    ]) {
      const src = readFileSync(path.resolve(process.cwd(), rel), 'utf8')
      for (const copy of userVisibleCopyFromSource(src)) {
        expect(copy).not.toMatch(/cockpit/i)
        expect(copy).not.toMatch(/驾驶舱/)
      }
    }
  })
})
