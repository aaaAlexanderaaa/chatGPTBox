/* eslint-env node */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { WebSocket } from 'ws'
import { createEngineRuntime } from '../src/engines/runtime.mjs'
import { createEngineStore } from '../src/engines/store.mjs'
import {
  ENGINE_BRIDGE_PROTOCOL,
  EngineOperation as Op,
  serializeEngineError,
} from '../src/engines/contract.mjs'
import { createEngineGateway } from '../scripts/lib/engine-gateway.mjs'

let child,
  bridge,
  base,
  directory,
  runtime,
  config,
  writes = 0
const apiHeaders = { Authorization: 'Bearer engine-api-test', 'Content-Type': 'application/json' }
const epoch = 'controlled-installation'
let releaseReceipt
const invoke = (prompt = 'Controlled question') => ({
  contractVersion: 1,
  operation: Op.Generate,
  input: { prompt },
})
async function respond(frame) {
  const command = frame.command
  const caller = { kind: command.role, principal: `gateway-${command.role}` }
  try {
    const payload = command.payload || {}
    const value = await {
      'engines.list': () => runtime.list(caller),
      'engines.models': () => runtime.models(payload.engineId, caller),
      'engines.invoke': () => runtime.invoke(payload, caller, command),
      'runs.read': () => runtime.read(payload.runId, caller),
      'runs.recover': () => runtime.recover(payload.runId, caller),
      'runs.cancel': () => runtime.cancel(payload.runId, caller),
    }[command.method]()
    if (command.method === 'engines.invoke' && payload.input.prompt === 'Hold the durable receipt')
      await new Promise((resolve) => {
        releaseReceipt = resolve
      })
    return { type: 'control_response', id: frame.id, data: value }
  } catch (error) {
    return {
      type: 'control_error',
      id: frame.id,
      error: error.message,
      engineError: serializeEngineError(error),
    }
  }
}
async function handshake() {
  bridge.send(
    JSON.stringify({
      type: 'bridge_config',
      engineProtocol: ENGINE_BRIDGE_PROTOCOL,
      installationId: epoch,
    }),
  )
  await new Promise((resolve) => setTimeout(resolve, 10))
}
beforeAll(async () => {
  const storage = {}
  config = { apiServerEnabled: true }
  const adapters = ['chatgptweb', 'grokweb', 'geminiweb', 'fourth'].map((id) => {
    config[`${id}Enabled`] = true
    const adapter = {
      describe: () => ({
        id,
        label: id,
        enabledKey: `${id}Enabled`,
        defaultEnabled: false,
        operations: { [Op.Generate]: { implemented: true } },
        execution: { concurrencyScope: 'engine' },
      }),
      resolveModel: () => 'configured-default',
      listModels: async () => ({
        items: [{ id: `${id}/configured-default` }],
        source: 'controlled',
        availability: 'observed',
      }),
      generate: async (_request, context) => {
        writes++
        await context.report({ type: 'accepted', evidence: { kind: 'controlled-native-response' } })
        return {
          outcome: 'completed',
          submission: 'accepted',
          finalOutput: { version: 1, format: 'markdown', content: 'Verified controlled final' },
        }
      },
    }
    return adapter
  })
  runtime = createEngineRuntime({
    adapters,
    store: createEngineStore({
      storage: {
        get: async (key) => ({ [key]: storage[key] }),
        set: async (patch) => Object.assign(storage, structuredClone(patch)),
      },
      uuid: () => epoch,
    }),
    getConfig: async () => structuredClone(config),
    setConfig: async (patch) => Object.assign(config, patch),
  })
  const probe = http.createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgptbox-engines-'))
  child = spawn(process.execPath, [
    'scripts/api-server.mjs',
    '--port',
    String(port),
    '--data-dir',
    directory,
    '--api-token',
    'engine-api-test',
    '--bridge-token',
    'engine-bridge-test',
  ])
  await new Promise((resolve, reject) => {
    let output = ''
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('listening')) resolve()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`Gateway exited ${code}: ${output}`)))
  })
  base = `http://127.0.0.1:${port}`
  bridge = new WebSocket(`${base.replace('http:', 'ws:')}/bridge?token=engine-bridge-test`, {
    headers: { Origin: 'chrome-extension://engine-controlled' },
  })
  await once(bridge, 'open')
  const socket = bridge
  bridge.on('message', async (raw) => {
    const frame = JSON.parse(String(raw))
    if (frame.type !== 'control_request') return
    const reply = await respond(frame)
    if (socket.readyState === 1) socket.send(JSON.stringify(reply))
  })
})
afterAll(async () => {
  bridge?.terminate()
  if (child?.exitCode === null) {
    const exit = once(child, 'exit')
    child.kill()
    await exit
  }
  if (directory) fs.rmSync(directory, { recursive: true, force: true })
})

describe('versioned gateway → bridge → common runtime', () => {
  it('refuses an incompatible bridge before any provider call', async () => {
    const response = await fetch(`${base}/engines/fourth/runs`, {
      method: 'POST',
      headers: { ...apiHeaders, 'Idempotency-Key': 'before-handshake' },
      body: JSON.stringify(invoke()),
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { submission: 'not_attempted' } })
    expect(writes).toBe(0)
    await handshake()
  })
  it('projects all three engines and a fourth adapter without another gateway branch', async () => {
    for (const engineId of ['chatgptweb', 'grokweb', 'geminiweb', 'fourth']) {
      const response = await fetch(`${base}/engines/${engineId}/runs`, {
        method: 'POST',
        headers: { ...apiHeaders, 'Idempotency-Key': `native-${engineId}` },
        body: JSON.stringify(invoke()),
      })
      expect(response.status).toBe(202)
      const receipt = await response.json()
      const lookup = await fetch(`${base}/operations/${encodeURIComponent(`native-${engineId}`)}`, {
        headers: apiHeaders,
      })
      expect(lookup.status).toBe(200)
      expect(await lookup.json()).toMatchObject({
        operationId: receipt.runId,
        result: { runId: receipt.runId },
      })
      await vi.waitFor(async () => {
        const run = await (
          await fetch(`${base}/runs/${receipt.runId}`, { headers: apiHeaders })
        ).json()
        expect(run).toMatchObject({
          engineId,
          phase: 'settled',
          outcome: 'completed',
          result: { content: 'Verified controlled final' },
        })
      })
      const replay = await fetch(`${base}/engines/${engineId}/runs`, {
        method: 'POST',
        headers: { ...apiHeaders, 'Idempotency-Key': `native-${engineId}` },
        body: JSON.stringify(invoke()),
      })
      expect((await replay.json()).runId).toBe(receipt.runId)
    }
    expect(writes).toBe(4)
  })
  it('shares the API credential, engine grants and existing runs with MCP', async () => {
    const mcp = createEngineGateway({ baseUrl: base, token: 'engine-api-test' })
    expect(fs.existsSync(path.join(directory, 'gateway-mcp-token'))).toBe(false)
    expect((await mcp.engines()).map((engine) => engine.id)).toEqual([
      'chatgptweb',
      'grokweb',
      'geminiweb',
      'fourth',
    ])
    expect((await mcp.engines())[0].effectiveOperations).toEqual([Op.Generate])
    await runtime.setExposure(
      'fourth',
      { externalEnabled: false },
      { kind: 'extension', principal: 'settings', admin: true },
    )
    await expect(mcp.start('fourth', { prompt: 'Denied question' })).rejects.toMatchObject({
      code: 'EXTERNAL_ACCESS_DISABLED',
      submission: 'not_attempted',
    })
    await runtime.setExposure(
      'fourth',
      { externalEnabled: true },
      { kind: 'extension', principal: 'settings', admin: true },
    )
    const ack = await mcp.start('fourth', { prompt: 'Explicitly authorized question' })
    await vi.waitFor(async () =>
      expect(await mcp.read(ack.runId)).toMatchObject({ outcome: 'completed' }),
    )
    const shared = await fetch(`${base}/runs/${ack.runId}`, { headers: apiHeaders })
    expect(shared.status).toBe(200)
    expect(await shared.json()).toMatchObject({ runId: ack.runId, outcome: 'completed' })
    const forged = await fetch(`${base}/engines/fourth/runs`, {
      method: 'POST',
      headers: { ...apiHeaders, 'Idempotency-Key': 'forged-role' },
      body: JSON.stringify({ ...invoke(), role: 'extension' }),
    })
    expect(forged.status).toBe(400)
    expect(writes).toBe(5)
  })
  it('returns 202 only after the registered run receipt reaches the gateway', async () => {
    let acknowledged = false
    const response = fetch(`${base}/engines/fourth/runs`, {
      method: 'POST',
      headers: { ...apiHeaders, 'Idempotency-Key': 'durable-receipt' },
      body: JSON.stringify(invoke('Hold the durable receipt')),
    }).then((value) => {
      acknowledged = true
      return value
    })
    await vi.waitFor(() => expect(releaseReceipt).toBeTypeOf('function'))
    const ledger = JSON.parse(
      fs.readFileSync(path.join(directory, 'gateway-operations.json'), 'utf8'),
    )
    const protectedRun = ledger.operations.find((item) => item.key === 'durable-receipt')
    expect(protectedRun.installationId).toBe(epoch)
    expect(
      await runtime.read(protectedRun.operationId, { kind: 'api', principal: 'gateway-api' }),
    ).toMatchObject({ runId: protectedRun.operationId })
    expect(acknowledged).toBe(false)
    releaseReceipt()
    expect((await response).status).toBe(202)
  })
  it('uses exactly the same invocation envelope over HTTP polling', async () => {
    const closed = once(bridge, 'close')
    bridge.close()
    await closed
    await new Promise((resolve) => setTimeout(resolve, 10))
    const poll = fetch(`${base}/bridge/poll`, {
      headers: { 'X-Bridge-Token': 'engine-bridge-test' },
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await fetch(`${base}/bridge/respond`, {
      method: 'POST',
      headers: { 'X-Bridge-Token': 'engine-bridge-test', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'bridge_config',
        engineProtocol: ENGINE_BRIDGE_PROTOCOL,
        installationId: epoch,
      }),
    })
    const responsePromise = fetch(`${base}/engines/fourth/runs`, {
      method: 'POST',
      headers: { ...apiHeaders, 'Idempotency-Key': 'poll-run' },
      body: JSON.stringify(invoke('Polling question')),
    })
    const frame = await (await poll).json()
    expect(frame.command).toMatchObject({
      protocol: ENGINE_BRIDGE_PROTOCOL,
      method: 'engines.invoke',
      role: 'api',
      installationId: epoch,
    })
    await fetch(`${base}/bridge/respond`, {
      method: 'POST',
      headers: { 'X-Bridge-Token': 'engine-bridge-test', 'Content-Type': 'application/json' },
      body: JSON.stringify(await respond(frame)),
    })
    expect((await responsePromise).status).toBe(202)
  })
})
