/* eslint-env node */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { rpcDeadlineMs } from '../src/modules/dsh/ui/models/rpc-deadline.mjs'

describe('rpc deadlines', () => {
  it('does not impose the 30s unary deadline on host.pickDirectory', () => {
    expect(rpcDeadlineMs('host.pickDirectory')).toBe(0)
    expect(rpcDeadlineMs('command.execute')).toBe(0)
    expect(rpcDeadlineMs('workspace.create')).toBe(30_000)
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/modules/dsh/ui/adapter/useGatewayPort.js'),
      'utf8',
    )
    expect(src).toMatch(/rpcDeadlineMs/)
  })
})
