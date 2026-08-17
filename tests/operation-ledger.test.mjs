/* eslint-env node */
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  fingerprintOperation,
  normalizeIdempotencyKey,
  OperationLedger,
} from '../scripts/lib/operation-ledger.mjs'

describe('gateway operation ledger', () => {
  const tempDirs = []

  function createLedger() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgptbox-operation-ledger-'))
    tempDirs.push(dir)
    return new OperationLedger({ file: path.join(dir, 'operations.json') })
  }

  afterEach(() => {
    while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true })
  })

  it('returns the same operation without creating another dispatch', () => {
    const ledger = createLedger()
    const fingerprint = fingerprintOperation('/write', { query: 'hello' })
    const first = ledger.begin({ key: 'request-1', fingerprint })
    const second = ledger.begin({ key: 'request-1', fingerprint })

    expect(first.kind).toBe('new')
    expect(second.kind).toBe('existing')
    expect(second.record.operationId).toBe(first.record.operationId)
    expect(second.record.state).toBe('dispatching')
  })

  it('accepts unkeyed standard-client writes without persisting or deduplicating them', () => {
    const ledger = createLedger()
    const first = ledger.begin({ fingerprint: 'same-request' })
    const second = ledger.begin({ fingerprint: 'same-request' })

    expect(first.kind).toBe('new')
    expect(second.kind).toBe('new')
    expect(second.record.operationId).not.toBe(first.record.operationId)
    expect(fs.existsSync(ledger.file)).toBe(false)

    ledger.complete(first.record, 'done')
    expect(first.record).toMatchObject({ state: 'completed', result: 'done' })
    expect(fs.existsSync(ledger.file)).toBe(false)
  })

  it('persists completed and ambiguous operations across restarts', () => {
    const ledger = createLedger()
    const file = ledger.file
    const completed = ledger.begin({ key: 'completed', fingerprint: 'a' }).record
    const ambiguous = ledger.begin({ key: 'ambiguous', fingerprint: 'b' }).record
    ledger.complete(completed, { conversationId: 'conv-1' })
    ledger.ambiguous(ambiguous, new Error('connection lost'))

    const reloaded = new OperationLedger({ file })
    expect(reloaded.begin({ key: 'completed', fingerprint: 'a' })).toMatchObject({
      kind: 'existing',
      record: { state: 'completed', result: { conversationId: 'conv-1' } },
    })
    expect(reloaded.begin({ key: 'ambiguous', fingerprint: 'b' })).toMatchObject({
      kind: 'existing',
      record: { state: 'ambiguous', error: 'connection lost' },
    })
  })

  it('aborts a dispatching record so the same key can be reused', () => {
    const ledger = createLedger()
    const fingerprint = fingerprintOperation('/grok/conversations', { query: 'hi' })
    const first = ledger.begin({ key: 'request-1', fingerprint })
    expect(first.kind).toBe('new')
    ledger.abort(first.record)
    const second = ledger.begin({ key: 'request-1', fingerprint })
    expect(second.kind).toBe('new')
    expect(second.record.operationId).not.toBe(first.record.operationId)
  })

  it('rejects reuse of a key for a different request', () => {
    const ledger = createLedger()
    ledger.begin({ key: 'request-1', fingerprint: 'a' })
    expect(ledger.begin({ key: 'request-1', fingerprint: 'b' }).kind).toBe('conflict')
  })

  it('normalizes safe keys and rejects control characters or oversized keys', () => {
    expect(normalizeIdempotencyKey(' request-1 ')).toBe('request-1')
    expect(normalizeIdempotencyKey('bad\nkey')).toBe('')
    expect(normalizeIdempotencyKey('x'.repeat(201))).toBe('')
  })

  it('fails closed when an existing ledger is corrupt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgptbox-operation-ledger-'))
    tempDirs.push(dir)
    const file = path.join(dir, 'operations.json')
    fs.writeFileSync(file, '{not-json')

    const ledger = new OperationLedger({ file })
    expect(ledger.begin({ fingerprint: 'standard-client-request' }).kind).toBe('new')
    expect(() => ledger.begin({ key: 'request-1', fingerprint: 'a' })).toThrowError(
      expect.objectContaining({ code: 'OPERATION_LEDGER_UNAVAILABLE' }),
    )
  })

  it('fails closed when the ledger JSON has an unknown shape', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgptbox-operation-ledger-'))
    tempDirs.push(dir)
    const file = path.join(dir, 'operations.json')
    fs.writeFileSync(file, JSON.stringify({ operations: [] }))

    const ledger = new OperationLedger({ file })
    expect(() => ledger.begin({ key: 'request-1', fingerprint: 'a' })).toThrowError(
      expect.objectContaining({ code: 'OPERATION_LEDGER_UNAVAILABLE' }),
    )
  })
})
