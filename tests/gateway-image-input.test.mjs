/* eslint-env node */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { WebSocket } from 'ws'
const taskDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgptbox-image-gateway-'))
let child, bridge
afterAll(async () => {
  bridge?.terminate()
  if (child && child.exitCode === null) {
    const exit = new Promise((resolve) => child.once('exit', resolve))
    child.kill()
    await exit
  }
  fs.rmSync(taskDataDirectory, { recursive: true, force: true })
})
describe('real HTTP gateway photo requests', () => {
  it('stages photos, reports preparation and sends one Project message across retries', async () => {
    const server = http.createServer()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    await new Promise((resolve) => server.close(resolve))
    child = spawn(
      process.execPath,
      [
        'scripts/api-server.mjs',
        '--port',
        String(port),
        '--data-dir',
        taskDataDirectory,
        '--api-token',
        'photo-api-test',
        '--bridge-token',
        'photo-bridge-test',
      ],
      { cwd: process.cwd() },
    )
    await new Promise((resolve, reject) => {
      let diagnostic = ''
      child.stderr.on('data', (chunk) => {
        diagnostic += String(chunk)
      })
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('listening')) resolve()
      })
      child.once('error', reject)
      child.once('exit', (code) => reject(new Error(`Gateway exited: ${code}: ${diagnostic}`)))
    })
    const base = `http://127.0.0.1:${port}`
    const headers = { Authorization: 'Bearer photo-api-test', 'Content-Type': 'application/json' }
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
    expect(
      (
        await fetch(base + '/chatgpt/attachments', {
          method: 'POST',
          body: JSON.stringify({ base64: png, mime_type: 'image/png' }),
        })
      ).status,
    ).toBe(401)
    const upload = await fetch(base + '/chatgpt/attachments', {
      method: 'POST',
      headers,
      body: JSON.stringify({ base64: png, mime_type: 'image/png' }),
    })
    expect(upload.status).toBe(201)
    const info = await upload.json()
    expect(info).not.toHaveProperty('base64')
    bridge = new WebSocket(`ws://127.0.0.1:${port}/bridge?token=photo-bridge-test`, {
      headers: { Origin: 'chrome-extension://photo-test-extension' },
    })
    await new Promise((resolve, reject) => {
      bridge.once('open', resolve)
      bridge.once('error', reject)
    })
    const dispatches = []
    let releaseUpload
    bridge.on('message', (raw) => {
      const message = JSON.parse(String(raw))
      if (message.type !== 'control_request') return
      dispatches.push(message)
      const reply = (data) =>
        bridge.send(JSON.stringify({ type: 'control_response', id: message.id, data }))
      if (message.action === 'chatgpt_web_upload_images')
        releaseUpload = () =>
          reply([
            {
              attachmentId: info.id,
              content_type: 'image_asset_pointer',
              asset_pointer: 'file-service://file-photo',
              size_bytes: 68,
              width: 1,
              height: 1,
            },
          ])
      else if (message.action === 'chatgpt_web_create_conversation')
        reply({ conversationId: 'conversation-1', messageId: 'message-1' })
      else if (message.action === 'chatgpt_web_list_projects')
        reply({ projects: [{ id: 'project-1', name: 'Food' }], cursor: null })
    })
    const body = { query: 'Analyze lunch', attachments: [info.id], project_id: 'project-1' }
    const send = () =>
      fetch(base + '/chatgpt/conversations', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': 'meal-1' },
        body: JSON.stringify(body),
      })
    expect((await send()).status).toBe(202)
    await vi.waitFor(() => expect(releaseUpload).toBeTypeOf('function'))
    let status = await (await fetch(base + '/chatgpt/operations/meal-1', { headers })).json()
    expect(status).toMatchObject({ phase: 'uploading', dispatched: false, pending: true })
    await send()
    expect(dispatches.filter((item) => item.action === 'chatgpt_web_upload_images')).toHaveLength(1)
    releaseUpload()
    await vi.waitFor(async () => {
      status = await (await fetch(base + '/chatgpt/operations/meal-1', { headers })).json()
      expect(status.phase).toBe('accepted')
    })
    await send()
    expect(
      dispatches.filter((item) => item.action === 'chatgpt_web_create_conversation'),
    ).toHaveLength(1)
    expect(
      dispatches.find((item) => item.action === 'chatgpt_web_create_conversation').payload,
    ).toMatchObject({
      projectId: 'project-1',
      images: [{ asset_pointer: 'file-service://file-photo' }],
    })
    const conflict = await fetch(base + '/chatgpt/conversations', {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'meal-1' },
      body: JSON.stringify({ ...body, query: 'Edited lunch' }),
    })
    expect(conflict.status).toBe(409)
    expect(status.result.messageId).toBe('message-1')
    expect(
      (await (await fetch(base + '/chatgpt/projects', { headers })).json()).projects[0].name,
    ).toBe('Food')
    expect((await fetch(base + '/chatgpt/operations/meal-1')).status).toBe(401)
  }, 15000)
})
