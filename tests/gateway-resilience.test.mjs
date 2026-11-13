import { announceEngineBridge, decodeCompatibilityFrame } from './helpers/engine-wire-fixture.mjs'
/* eslint-env node */
import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { WebSocket } from 'ws'

const instances = []
const bridges = []
const headers = { Authorization: 'Bearer resilience-api', 'Content-Type': 'application/json' }

async function startGateway({ failPong = false } = {}) {
  const probe = http.createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgptbox-resilience-'))
  const preloadArgs = []
  if (failPong) {
    const preload = path.join(directory, 'fail-pong.mjs')
    fs.writeFileSync(
      preload,
      `
      import { WebSocket } from ${JSON.stringify(import.meta.resolve('ws'))}
      const original = WebSocket.prototype.send
      WebSocket.prototype.send = function (data, ...args) {
        if (data === '{"type":"pong"}') throw new Error('Injected callback failure')
        return original.call(this, data, ...args)
      }
    `,
    )
    preloadArgs.push('--import', preload)
  }
  const child = spawn(process.execPath, [
    ...preloadArgs,
    'scripts/api-server.mjs',
    '--port',
    String(port),
    '--data-dir',
    directory,
    '--api-token',
    'resilience-api',
    '--bridge-token',
    'resilience-bridge',
  ])
  const instance = { child, directory, port, base: `http://127.0.0.1:${port}`, output: '' }
  instances.push(instance)
  child.stdout.on('data', (chunk) => (instance.output += String(chunk)))
  child.stderr.on('data', (chunk) => (instance.output += String(chunk)))
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(instance.output || 'Startup timed out')),
      5000,
    )
    const ready = (chunk) => {
      if (!String(chunk).includes('listening')) return
      clearTimeout(timeout)
      child.stdout.off('data', ready)
      resolve()
    }
    child.stdout.on('data', ready)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      reject(new Error(`Gateway exited ${code ?? signal}: ${instance.output}`))
    })
  })
  return instance
}

async function connectBridge(instance) {
  const bridge = new WebSocket(`${instance.base.replace('http:', 'ws:')}/bridge`, {
    headers: { 'X-Bridge-Token': 'resilience-bridge' },
  })
  bridges.push(bridge)
  await once(bridge, 'open')
  await announceEngineBridge(bridge)
  return bridge
}

function rawRequest(instance, target, authorization = '') {
  return new Promise((resolve, reject) => {
    const socket = net.connect(instance.port, '127.0.0.1')
    let response = ''
    socket.setTimeout(3000, () => socket.destroy(new Error('HTTP response timed out')))
    socket.once('connect', () => {
      socket.end(
        `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${instance.port}\r\n${
          authorization ? `Authorization: ${authorization}\r\n` : ''
        }Connection: close\r\n\r\n`,
      )
    })
    socket.on('data', (chunk) => (response += String(chunk)))
    socket.once('end', () => resolve(response))
    socket.once('error', reject)
  })
}

afterEach(async () => {
  for (const bridge of bridges.splice(0)) bridge.terminate()
  for (const instance of instances.splice(0)) {
    if (instance.child.exitCode === null && instance.child.signalCode === null) {
      const exited = once(instance.child, 'exit')
      instance.child.kill()
      await exited
    }
    fs.rmSync(instance.directory, { recursive: true, force: true })
  }
})

describe('gateway request isolation', () => {
  it.each([
    ['//[/', ''],
    ['/chatgpt/conversations/%E0%A4%A', 'Bearer resilience-api'],
    ['/grok/conversations/%E0%A4%A', 'Bearer resilience-api'],
  ])('rejects malformed target %s without exiting', async (target, authorization) => {
    const instance = await startGateway()
    const response = await rawRequest(instance, target, authorization)
    expect(response).toMatch(/^HTTP\/1\.1 400 /)
    expect((await fetch(`${instance.base}/status`, { headers })).status).toBe(200)
    expect((await fetch(`${instance.base}/status`)).status).toBe(401)
    expect(instance.child.exitCode).toBeNull()
  })

  it('ignores invalid WebSocket message envelopes and still answers a valid ping', async () => {
    const instance = await startGateway()
    const bridge = await connectBridge(instance)
    const pong = once(bridge, 'message')
    for (const body of [
      'null',
      '[]',
      'true',
      '"text"',
      '{}',
      '{',
      JSON.stringify({ type: 'bridge_config', requestTimeoutSeconds: { toString: {} } }),
      JSON.stringify({ type: 'done', id: {} }),
      JSON.stringify({ type: 'control_error', id: 'unknown', error: { toString: {} } }),
    ])
      bridge.send(body)
    bridge.send(JSON.stringify({ type: 'ping' }))
    const [raw] = await Promise.race([
      pong,
      once(instance.child, 'exit').then(() => {
        throw new Error(instance.output)
      }),
    ])
    expect(JSON.parse(String(raw))).toEqual({ type: 'pong' })
    expect((await fetch(`${instance.base}/health`, { headers })).status).toBe(200)
  })

  it('rejects invalid HTTP bridge messages without stopping subsequent requests', async () => {
    const instance = await startGateway()
    for (const body of ['null', '[]', 'true', '"text"', '{}']) {
      const response = await fetch(`${instance.base}/bridge/respond`, {
        method: 'POST',
        headers: { 'X-Bridge-Token': 'resilience-bridge' },
        body,
      })
      expect(response.status).toBe(400)
    }
    expect((await fetch(`${instance.base}/status`, { headers })).status).toBe(200)
  })

  it('confines an unexpected WebSocket callback exception to that bridge', async () => {
    const instance = await startGateway({ failPong: true })
    const bridge = await connectBridge(instance)
    const closed = once(bridge, 'close')
    bridge.send(JSON.stringify({ type: 'ping' }))
    await closed
    expect((await fetch(`${instance.base}/health`, { headers })).status).toBe(503)
    expect(instance.child.exitCode).toBeNull()
    await connectBridge(instance)
    expect((await fetch(`${instance.base}/health`, { headers })).status).toBe(200)
  })

  it('contains invalid WebSocket frame errors without exiting', async () => {
    const instance = await startGateway()
    const bridge = await connectBridge(instance)
    const closed = once(bridge, 'close')
    // Bypass the client's frame encoder to send a masked ping with illegal RSV1.
    // This exercises the server ws instance's asynchronous error event.
    bridge._socket.write(Buffer.from([0xc9, 0x80, 0, 0, 0, 0]))
    await closed
    expect((await fetch(`${instance.base}/health`, { headers })).status).toBe(503)
    expect(instance.child.exitCode).toBeNull()
    expect(instance.output).toContain('WebSocket bridge error:')
  })

  it('preserves valid encoded IDs and a successful subsequent request', async () => {
    const instance = await startGateway()
    const bridge = await connectBridge(instance)
    const requests = []
    bridge.on('message', (raw) => {
      const message = decodeCompatibilityFrame(JSON.parse(String(raw)))
      requests.push(message)
      bridge.send(
        JSON.stringify({
          type: 'control_response',
          id: message.id,
          data: { conversationId: message.payload.conversationId, messages: [] },
        }),
      )
    })
    const response = await fetch(`${instance.base}/chatgpt/conversations/folder%2Fchild`, {
      headers,
    })
    expect(response.status).toBe(200)
    expect(requests[0].payload.conversationId).toBe('folder/child')
    expect((await response.json()).conversationId).toBe('folder/child')
  })

  it('keeps an interrupted write ambiguous across bridge reconnection and client retry', async () => {
    const instance = await startGateway()
    const bridge = await connectBridge(instance)
    const dispatched = once(bridge, 'message')
    const send = () =>
      fetch(`${instance.base}/chatgpt/conversations`, {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': 'interrupted-write' },
        body: JSON.stringify({ query: 'Local fake bridge only' }),
      })
    const pending = send()
    const [raw] = await dispatched
    expect(decodeCompatibilityFrame(JSON.parse(String(raw))).action).toBe(
      'chatgpt_web_create_conversation',
    )
    bridge.close(1001, 'Simulated bridge interruption')
    const failed = await pending
    expect(failed.status).toBe(409)
    expect(await failed.json()).toMatchObject({
      error: { code: 'ambiguous_dispatch', retryable: false },
    })
    expect((await fetch(`${instance.base}/health`, { headers })).status).toBe(503)
    const replacement = await connectBridge(instance)
    let redispatches = 0
    replacement.on('message', (raw) => {
      if (JSON.parse(String(raw)).type === 'control_request') redispatches++
    })
    expect((await send()).status).toBe(409)
    expect((await fetch(`${instance.base}/health`, { headers })).status).toBe(200)
    // An application pong is ordered after any earlier frames queued by the
    // server, so the no-redispatch assertion observes those frames too.
    const pong = new Promise((resolve) => {
      replacement.on('message', (raw) => {
        if (JSON.parse(String(raw)).type === 'pong') resolve()
      })
    })
    replacement.send(JSON.stringify({ type: 'ping' }))
    await pong
    expect(redispatches).toBe(0)
  })
})
