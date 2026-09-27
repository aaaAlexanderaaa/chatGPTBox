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

    bridge.on('message', (raw) => {
      const message = JSON.parse(String(raw))
      if (message.type === 'control_request' && message.action === 'chatgpt_web_get_turn_status') {
        bridge.send(JSON.stringify({ type: 'control_response', id: message.id, data: null }))
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
    bridge.close()
  }, 30_000)
})
