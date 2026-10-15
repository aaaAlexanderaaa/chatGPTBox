/* eslint-env node */
import { once } from 'node:events'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { WebSocket } from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let child, bridge, directory, base
beforeAll(async () => {
  const probe = net.createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgptbox-image-recovery-'))
  child = spawn(
    process.execPath,
    [
      'scripts/api-server.mjs',
      '--port',
      String(port),
      '--data-dir',
      directory,
      '--api-token',
      'image-recovery-api',
      '--bridge-token',
      'image-recovery-bridge',
    ],
    { cwd: process.cwd() },
  )
  await new Promise((resolve, reject) => {
    let diagnostic = ''
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('listening')) resolve()
    })
    child.stderr.on('data', (chunk) => {
      diagnostic += chunk
    })
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`Gateway exited: ${code}: ${diagnostic}`)))
  })
  base = `http://127.0.0.1:${port}`
  bridge = new WebSocket(`ws://127.0.0.1:${port}/bridge?token=image-recovery-bridge`, {
    headers: { Origin: 'chrome-extension://image-recovery-test' },
  })
  await once(bridge, 'open')
}, 15000)

afterAll(async () => {
  bridge?.terminate()
  if (child && child.exitCode === null) {
    const exit = once(child, 'exit')
    child.kill()
    await exit
  }
  if (directory) fs.rmSync(directory, { recursive: true, force: true })
})

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
async function send(key, stream) {
  const response = await fetch(base + '/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer image-recovery-api',
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify({
      model: 'gpt-6-thinking',
      stream,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this meal' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,' + png } },
          ],
        },
      ],
    }),
  })
  const text = await response.text()
  const frames = response.headers.get('Content-Type').includes('text/event-stream')
    ? text
        .split('\n')
        .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
        .map((line) => JSON.parse(line.slice(6)))
    : [JSON.parse(text)]
  return { response, text, error: frames.find((frame) => frame.error)?.error }
}

describe('OpenAI-compatible image send recovery', () => {
  it.each([false, true])(
    'allows a manual retry after a proven upload failure (stream=%s)',
    async (stream) => {
      const requests = []
      const onRequest = (raw) => {
        const message = JSON.parse(String(raw))
        if (message.type !== 'request') return
        requests.push(message)
        bridge.send(
          JSON.stringify(
            requests.length === 1
              ? { type: 'error', id: message.id, error: 'Photo upload failed', dispatched: false }
              : { type: 'done', id: message.id, answer: 'Meal analysis' },
          ),
        )
      }
      bridge.on('message', onRequest)
      try {
        const key = `unsent-image-${stream}`
        const first = await send(key, stream)
        expect(first.response.status).toBe(stream ? 200 : 503)
        expect(first.response.headers.get('x-should-retry')).toBe('false')
        expect(first.error).toMatchObject({
          code: 'chatgpt_not_dispatched',
          message: 'Photo upload failed',
          dispatched: false,
          retryable: false,
        })
        const ledger = JSON.parse(
          fs.readFileSync(path.join(directory, 'gateway-operations.json'), 'utf8'),
        )
        expect(ledger.operations.some((operation) => operation.key === key)).toBe(false)
        const second = await send(key, stream)
        expect(second.response.status).toBe(200)
        expect(second.error).toBeUndefined()
        expect(second.text).toContain('Meal analysis')
        expect(requests).toHaveLength(2)
        expect(requests[1].images).toHaveLength(1)
        const replay = await send(key, stream)
        expect(replay.text).toContain('Meal analysis')
        expect(requests).toHaveLength(2)
      } finally {
        bridge.off('message', onRequest)
      }
    },
  )

  it.each([
    [false, undefined],
    [true, undefined],
    [false, true],
    [true, true],
  ])(
    'does not release a possibly dispatched request (stream=%s, dispatched=%s)',
    async (stream, dispatched) => {
      let count = 0
      const onRequest = (raw) => {
        const message = JSON.parse(String(raw))
        if (message.type !== 'request') return
        count++
        bridge.send(
          JSON.stringify({
            type: 'error',
            id: message.id,
            error: 'Acknowledgement lost',
            dispatched,
          }),
        )
      }
      bridge.on('message', onRequest)
      try {
        const key = `uncertain-image-${stream}-${dispatched}`
        const first = await send(key, stream)
        expect(first.error.code).toBe('ambiguous_dispatch')
        expect(first.response.status).toBe(stream ? 200 : 409)
        expect(first.response.headers.get('x-should-retry')).toBe('false')
        expect(first.error.retryable).toBe(false)
        const retry = await send(key, stream)
        expect(retry.response.status).toBe(409)
        expect(retry.error.code).toBe('ambiguous_dispatch')
        expect(count).toBe(1)
      } finally {
        bridge.off('message', onRequest)
      }
    },
  )
})
