/* eslint-env node */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_RECORDS = 2000

export function normalizeIdempotencyKey(value) {
  if (Array.isArray(value)) value = value[0]
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  if (
    !normalized ||
    normalized.length > 200 ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
  )
    return ''
  return normalized
}

export function fingerprintOperation(route, payload) {
  return crypto.createHash('sha256').update(JSON.stringify({ route, payload })).digest('hex')
}

export class OperationLedger {
  constructor({ file, ttlMs = DEFAULT_TTL_MS, maxRecords = DEFAULT_MAX_RECORDS } = {}) {
    this.file = file || ''
    this.ttlMs = ttlMs
    this.maxRecords = maxRecords
    this.records = new Map()
    this.available = true
    this.loadError = null
    this.load()
  }

  load() {
    if (!this.file) return
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (parsed?.version !== 1 || !Array.isArray(parsed?.operations)) {
        throw new Error('Unsupported or invalid operation ledger format')
      }
      const entries = parsed.operations
      for (const record of entries) {
        if (record?.key && record?.operationId && record?.fingerprint) {
          this.records.set(record.key, record)
        }
      }
      this.prune(false)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.available = false
        this.loadError = error
      }
    }
  }

  begin({ key, fingerprint, operationId = crypto.randomUUID() }) {
    const normalizedKey = normalizeIdempotencyKey(key)
    if (!normalizedKey) {
      const now = new Date().toISOString()
      return {
        kind: 'new',
        record: {
          key: null,
          clientKey: null,
          operationId,
          fingerprint,
          state: 'dispatching',
          createdAt: now,
          updatedAt: now,
          result: null,
          error: null,
        },
      }
    }

    if (!this.available) {
      const error = new Error(
        `The idempotency ledger is unavailable: ${this.loadError?.message || 'unknown error'}`,
      )
      error.code = 'OPERATION_LEDGER_UNAVAILABLE'
      throw error
    }
    const existing = this.records.get(normalizedKey)
    if (existing) {
      return existing.fingerprint === fingerprint
        ? { kind: 'existing', record: existing }
        : { kind: 'conflict', record: existing }
    }

    const now = new Date().toISOString()
    const record = {
      key: normalizedKey,
      clientKey: normalizedKey,
      operationId,
      fingerprint,
      state: 'dispatching',
      createdAt: now,
      updatedAt: now,
      result: null,
      error: null,
    }
    this.records.set(record.key, record)
    this.prune(false)
    try {
      this.persist()
    } catch (error) {
      this.records.delete(record.key)
      throw error
    }
    return { kind: 'new', record }
  }

  complete(record, result) {
    return this.update(record, { state: 'completed', result, error: null })
  }

  ambiguous(record, error) {
    return this.update(record, {
      state: 'ambiguous',
      error: error?.message || String(error || 'The upstream write result is unknown'),
    })
  }

  update(record, patch) {
    if (!record?.key) {
      Object.assign(record, patch, { updatedAt: new Date().toISOString() })
      return record
    }
    if (!this.records.has(record.key)) return record
    Object.assign(record, patch, { updatedAt: new Date().toISOString() })
    this.persist()
    return record
  }

  prune(persist = true) {
    const cutoff = Date.now() - this.ttlMs
    for (const [key, record] of this.records) {
      const updatedAt = Date.parse(record.updatedAt || record.createdAt || '')
      if (!Number.isFinite(updatedAt) || updatedAt < cutoff) this.records.delete(key)
    }
    if (this.records.size > this.maxRecords) {
      const oldest = [...this.records.values()].sort(
        (a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt),
      )
      for (const record of oldest.slice(0, this.records.size - this.maxRecords)) {
        this.records.delete(record.key)
      }
    }
    if (persist) this.persist()
  }

  persist() {
    if (!this.file) return
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 })
      const tempFile = `${this.file}.${process.pid}.tmp`
      fs.writeFileSync(
        tempFile,
        `${JSON.stringify({ version: 1, operations: [...this.records.values()] }, null, 2)}\n`,
        { mode: 0o600 },
      )
      fs.renameSync(tempFile, this.file)
      fs.chmodSync(this.file, 0o600)
    } catch (error) {
      this.available = false
      this.loadError = error
      const ledgerError = new Error(`Failed to persist the idempotency ledger: ${error.message}`)
      ledgerError.code = 'OPERATION_LEDGER_UNAVAILABLE'
      throw ledgerError
    }
  }
}
