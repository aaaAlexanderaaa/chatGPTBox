/* eslint-env node */
import { afterAll, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../scripts/api-server.mjs',
)
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgptbox-gateway-test-'))
let child

async function freePort() {
  const server = http.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

afterAll(() => {
  child?.kill()
  fs.rmSync(home, { recursive: true, force: true })
})

describe('API gateway HTTP access', () => {
  it('requires client auth and reflects only configured browser origins', async () => {
    const port = await freePort()
    fs.mkdirSync(path.join(home, '.chatgptbox'), { recursive: true })
    fs.writeFileSync(
      path.join(home, '.chatgptbox', 'gateway-operations.json'),
      JSON.stringify({
        version: 1,
        operations: [
          {
            key: 'legacy-runtime',
            clientKey: 'legacy-runtime',
            operationId: 'legacy-operation',
            fingerprint: 'old-request',
            state: 'ambiguous',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            result: null,
            error:
              'Uncaught Error: The loaded ChatGPT page runtime is not supported. Refresh the proxy tab and check for a ChatGPTBox protocol update.',
          },
        ],
      }),
    )
    child = spawn(process.execPath, [script, '--port', String(port)], {
      env: {
        ...process.env,
        HOME: home,
        CHATGPT_GATEWAY_API_TOKEN: 'api-test-token',
        CHATGPT_GATEWAY_BRIDGE_TOKEN: 'bridge-test-token',
        CHATGPT_GATEWAY_ALLOWED_ORIGINS: 'https://trusted.example',
      },
    })
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('listening')) resolve()
      })
      child.on('error', reject)
      child.on('exit', (code) => reject(new Error(`API gateway exited: ${code}`)))
    })
    const url = `http://127.0.0.1:${port}/health`
    expect((await fetch(url)).status).toBe(401)
    const authorized = await fetch(url, { headers: { Authorization: 'Bearer api-test-token' } })
    expect(authorized.status).toBe(503) // Bridge is intentionally disconnected in this test.
    expect(authorized.headers.get('access-control-allow-origin')).toBeNull()

    const trusted = await fetch(url, {
      headers: { Authorization: 'Bearer api-test-token', Origin: 'https://trusted.example' },
    })
    expect(trusted.status).toBe(503)
    expect(trusted.headers.get('access-control-allow-origin')).toBe('https://trusted.example')
    const untrusted = await fetch(url, {
      headers: { Authorization: 'Bearer api-test-token', Origin: 'https://evil.example' },
    })
    expect(untrusted.status).toBe(403)
    expect(untrusted.headers.get('access-control-allow-origin')).toBeNull()

    const forgedHost = await new Promise((resolve, reject) => {
      const req = http.request(
        url,
        { headers: { Host: `evil.example:${port}`, Authorization: 'Bearer api-test-token' } },
        (res) => {
          res.resume()
          resolve(res.statusCode)
        },
      )
      req.on('error', reject)
      req.end()
    })
    expect(forgedHost).toBe(403)

    const pairedOrigin = 'chrome-extension://paired-test-extension'
    const bridge = new WebSocket(`ws://127.0.0.1:${port}/bridge?token=bridge-test-token`, {
      headers: { Origin: pairedOrigin },
    })
    await new Promise((resolve, reject) => {
      bridge.once('open', resolve)
      bridge.once('error', reject)
    })
    const paired = await fetch(url, {
      headers: { Authorization: 'Bearer bridge-test-token', Origin: pairedOrigin },
    })
    expect(paired.status).toBe(200)
    expect(paired.headers.get('access-control-allow-origin')).toBe(pairedOrigin)
    const otherExtension = await fetch(url, {
      headers: {
        Authorization: 'Bearer bridge-test-token',
        Origin: 'chrome-extension://other-extension',
      },
    })
    expect(otherExtension.status).toBe(403)

    let writeDispatches = 0
    bridge.on('message', (raw) => {
      const message = JSON.parse(String(raw))
      if (message.type === 'control_request' && message.action === 'chatgpt_web_get_turn_status') {
        bridge.send(JSON.stringify({ type: 'control_response', id: message.id, data: null }))
      }
      if (
        message.type === 'control_request' &&
        message.action === 'chatgpt_web_create_conversation'
      ) {
        writeDispatches += 1
        const query = message.payload.query
        if (query === 'unsent') {
          bridge.send(
            JSON.stringify({
              type: 'control_response',
              id: message.id,
              data: {
                dispatched: false,
                error: 'Unsupported runtime',
                code: 'CHATGPT_WEB_RUNTIME_UNSUPPORTED',
              },
            }),
          )
        } else if (query === 'uncertain') {
          bridge.send(
            JSON.stringify({
              type: 'control_error',
              id: message.id,
              error: 'Acknowledgement lost',
            }),
          )
        } else {
          bridge.send(
            JSON.stringify({
              type: 'control_response',
              id: message.id,
              data: { conversationId: 'conversation-1', messageId: 'message-1', query },
            }),
          )
        }
      }
    })
    const missing = await fetch(
      `http://127.0.0.1:${port}/chatgpt/conversations/unknown/turns/unknown`,
      { headers: { Authorization: 'Bearer api-test-token' } },
    )
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({
      error: { code: 'turn_status_not_found', retryable: false },
    })

    const write = (key, query) =>
      fetch(`http://127.0.0.1:${port}/chatgpt/conversations`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer api-test-token',
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify({ query }),
      })
    const unsent = await write('draft-unsent', 'unsent')
    expect(unsent.status).toBe(503)
    expect(await unsent.json()).toMatchObject({ error: { dispatched: false, retryable: false } })
    expect((await write('draft-unsent', 'edited')).status).toBe(200)
    const conflict = await write('draft-unsent', 'edited again')
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({
      error: {
        code: 'idempotency_key_conflict',
        operation_state: 'completed',
        operation_result: { query: 'edited', messageId: 'message-1' },
      },
    })
    expect(writeDispatches).toBe(2)

    const ambiguous = await write('draft-uncertain', 'uncertain')
    expect(ambiguous.status).toBe(409)
    expect(await ambiguous.json()).toMatchObject({ error: { code: 'ambiguous_dispatch' } })
    expect((await write('draft-uncertain', 'edited')).status).toBe(409)
    expect(writeDispatches).toBe(3)

    expect((await write('legacy-runtime', 'edited legacy request')).status).toBe(200)
    expect(writeDispatches).toBe(4)
    bridge.close()
  }, 30_000)
})
