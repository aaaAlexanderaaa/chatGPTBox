/* global process */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

import {
  CHATGPT_PROXY_CONTROL_ACTIONS,
  RUNTIME_MESSAGE_TYPES,
  RuntimeMessage,
  ChatgptProxyControlAction,
} from '../src/protocol/messages.mjs'

// Contract test for the runtime message layer (architecture plan step 2).
//
// Goal: a new message type must be defined ONCE in src/protocol/messages.mjs
// and referenced everywhere via that constant. This catches two regressions:
//   1. "sender added a type, receiver didn't" — a constant defined but never
//      referenced on the opposite side of the wire.
//   2. literal drift — a known type's string value written as a bare literal
//      somewhere in src instead of via the constant.
//
// We scan source STATICALLY (no module import side effects). Other `type:`
// keys in the codebase (Blob MIME, JSON-schema `type`, declarativeNetRequest
// `type: 'modifyHeaders'`, websocket bridge `type: 'ping'`, error-code
// switches like `case 'UNAUTHORIZED'`, JWT `sign_type`) are NOT runtime
// messages and are out of scope. We therefore match on exact string VALUES of
// the known message types rather than every UPPER_SNAKE literal.

const require = createRequire(import.meta.url)
const SRC_ROOT = resolve(process.cwd(), 'src')

function listSourceFiles() {
  const { readdirSync, statSync } = require('node:fs')
  const out = []
  const stack = [SRC_ROOT]
  const EXTS = ['.mjs', '.jsx']
  while (stack.length) {
    const dir = stack.pop()
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) stack.push(full)
      else if (EXTS.some((ext) => full.endsWith(ext))) out.push(full)
    }
  }
  return out
}

// Escape a string for use inside a JS regex.
function reEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// For a given message-type string value, build the regexes that match a bare
// literal usage of it (i.e. NOT going through a RuntimeMessage.* constant):
//   sender:    type: 'VALUE'
//   receiver:  case 'VALUE':        message.type === 'VALUE'
// We match the value wrapped in single quotes so partial-word matches are
// impossible.
function literalMatchers(value) {
  const v = reEscape(value)
  return [
    new RegExp(`type:\\s*'${v}'`),
    new RegExp(`case\\s+'${v}'\\s*:`),
    new RegExp(`\\.type\\s*===\\s*'${v}'`),
    new RegExp(`'${v}':\\s*'`, 'm'), // mapping-table entry `'VALUE': '...'`
  ]
}

describe('message contract: RuntimeMessage definitions', () => {
  it('every RuntimeMessage value is unique and UPPER_SNAKE_CASE', () => {
    const values = Object.values(RuntimeMessage)
    expect(new Set(values).size, 'no duplicate message type values').toBe(values.length)
    for (const v of values) {
      expect(v, `type ${v} should be UPPER_SNAKE_CASE`).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })

  it('every RuntimeMessage constant is referenced (via RuntimeMessage.X) at least twice', () => {
    // A well-formed contract entry is used on both sides of the wire: once in
    // messages.mjs (its definition) and at least once elsewhere (a sender or
    // receiver). A constant referenced only once is unpaired — a typo'd,
    // renamed, or dead entry.
    const files = listSourceFiles()
      .filter((f) => !f.includes('protocol/messages.mjs'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')

    const unpaired = []
    for (const [name] of Object.entries(RuntimeMessage)) {
      const ref = `RuntimeMessage.${name}`
      const count = files.split(ref).length - 1
      if (count < 1) {
        unpaired.push(`${name} — referenced ${count} time(s) outside messages.mjs`)
      }
    }
    expect(
      unpaired,
      'these RuntimeMessage constants are never used outside their definition:\n  ' +
        unpaired.join('\n  '),
    ).toEqual([])
  })
})

describe('message contract: no bare message-type literals', () => {
  it('no message-type value is written as a bare literal in src (must use the constant)', () => {
    const offenders = []
    for (const file of listSourceFiles()) {
      if (file.includes('protocol/messages.mjs')) continue // definition site
      const source = readFileSync(file, 'utf8')
      const rel = file.replace(SRC_ROOT + '/', '')
      for (const value of RUNTIME_MESSAGE_TYPES) {
        for (const re of literalMatchers(value)) {
          if (re.test(source)) {
            offenders.push(`${rel}: bare literal "${value}" — use RuntimeMessage instead`)
          }
        }
      }
    }
    expect(
      offenders.sort(),
      'found message-type values written as bare literals — route them through ' +
        'RuntimeMessage so the value has a single source of truth:\n  ' +
        offenders.join('\n  '),
    ).toEqual([])
  })

  it('no chatgpt_web_* control action is written as a bare literal in src (must use the constant)', () => {
    const offenders = []
    for (const file of listSourceFiles()) {
      if (file.includes('protocol/messages.mjs')) continue
      const source = readFileSync(file, 'utf8')
      const rel = file.replace(SRC_ROOT + '/', '')
      for (const value of CHATGPT_PROXY_CONTROL_ACTIONS) {
        const re = new RegExp(`'${reEscape(value)}'`)
        if (re.test(source)) {
          offenders.push(`${rel}: bare literal "${value}" — use ChatgptProxyControlAction instead`)
        }
      }
    }
    expect(
      offenders.sort(),
      'found proxy-control action values written as bare literals:\n  ' + offenders.join('\n  '),
    ).toEqual([])
  })
})

describe('message contract: ChatgptProxyControlAction definitions', () => {
  it('every action value is unique and lowercase snake_case', () => {
    const values = Object.values(ChatgptProxyControlAction)
    expect(new Set(values).size).toBe(values.length)
    for (const v of values) {
      expect(v).toMatch(/^chatgpt_web_[a-z_]+$/)
    }
  })
})
