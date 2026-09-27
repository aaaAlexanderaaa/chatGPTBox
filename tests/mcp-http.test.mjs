/* eslint-env node */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mcpScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../scripts/mcp-server.mjs',
)
const servers = []
const children = []

async function freePort() {
  const listener = http.createServer()
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  await new Promise((resolve) => listener.close(resolve))
  return port
}

afterAll(async () => {
  for (const child of children) child.kill()
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
})

describe('MCP HTTP conversation flow', () => {
  it('authenticates, holds a tool call, and polls only the local turn endpoint', async () => {
    let creates = 0
    let statusReads = 0
    let conversationReads = 0
    let holdTurns = false
    const createdBodies = []
    const gateway = http.createServer(async (req, res) => {
      if (req.headers.authorization !== 'Bearer gateway-test-token') {
        res.writeHead(401).end()
        return
      }
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'POST' && req.url === '/chatgpt/conversations') {
        creates++
        expect(req.headers['idempotency-key']).toBeTruthy()
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        createdBodies.push(JSON.parse(Buffer.concat(chunks).toString()))
        res.end(JSON.stringify({ conversationId: 'conversation-1', messageId: 'message-1' }))
      } else if (
        req.method === 'GET' &&
        req.url === '/chatgpt/conversations/conversation-1/turns/message-1'
      ) {
        statusReads++
        res.end(
          JSON.stringify(
            statusReads >= 3 && !holdTurns
              ? {
                  conversationId: 'conversation-1',
                  messageId: 'message-1',
                  status: 'completed',
                  text: 'Final answer',
                  thoughtDurationSec: 12,
                }
              : {
                  conversationId: 'conversation-1',
                  messageId: 'message-1',
                  status: 'running',
                  text: 'Thinking',
                },
          ),
        )
      } else {
        conversationReads++
        res.writeHead(404).end(JSON.stringify({ error: { message: 'Unexpected path' } }))
      }
    })
    servers.push(gateway)
    await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve))
    const gatewayPort = gateway.address().port
    const mcpPort = await freePort()
    const child = spawn(
      process.execPath,
      [mcpScript, '--port', String(mcpPort), '--gateway-port', String(gatewayPort)],
      {
        env: {
          ...process.env,
          CHATGPT_MCP_TOKEN: 'mcp-test-token',
          CHATGPT_GATEWAY_API_TOKEN: 'gateway-test-token',
          CHATGPT_MCP_POLL_MS: '30',
        },
      },
    )
    children.push(child)
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('ChatGPTBox MCP:')) resolve()
      })
      child.on('error', reject)
      child.on('exit', (code) => reject(new Error(`MCP exited: ${code}`)))
    })

    const url = `http://127.0.0.1:${mcpPort}/mcp`
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'ask_chatgpt', arguments: { query: 'Research something' } },
    })
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }
    const initialized = await fetch(url, {
      method: 'POST',
      headers: { ...headers, Authorization: 'Bearer mcp-test-token' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 98,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1' },
        },
      }),
    })
    const initializedEvent = (await initialized.text())
      .split('\n')
      .find((line) => line.startsWith('data: '))
      ?.slice('data: '.length)
    expect(JSON.parse(initializedEvent).result.instructions).toContain('capable peer agent')
    expect(JSON.parse(initializedEvent).result.instructions).toContain('do not try to override')
    const listed = await fetch(url, {
      method: 'POST',
      headers: { ...headers, Authorization: 'Bearer mcp-test-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: {} }),
    })
    const listedEvent = (await listed.text())
      .split('\n')
      .find((line) => line.startsWith('data: '))
      ?.slice('data: '.length)
    const listedTools = JSON.parse(listedEvent).result.tools
    expect(listedTools.map((tool) => tool.name)).toEqual(['ask_chatgpt'])
    expect(listedTools[0].description).toContain('not for keyword search or trivial tests')
    expect(Object.keys(listedTools[0].inputSchema.properties)).toEqual(['query'])
    expect(listedTools[0].inputSchema.additionalProperties).toBe(false)
    expect(listedTools[0].inputSchema.properties.query.description).toContain('One clear question')
    const modelOverride = await fetch(url, {
      method: 'POST',
      headers: { ...headers, Authorization: 'Bearer mcp-test-token' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 101,
        method: 'tools/call',
        params: {
          name: 'ask_chatgpt',
          arguments: { query: 'A real question', model: 'some-other-model' },
        },
      }),
    })
    const modelOverrideEvent = (await modelOverride.text())
      .split('\n')
      .find((line) => line.startsWith('data: '))
      ?.slice('data: '.length)
    const modelOverrideResult = JSON.parse(modelOverrideEvent)
    expect(modelOverrideResult.error || modelOverrideResult.result?.isError).toBeTruthy()
    expect(creates).toBe(0)
    for (const name of ['continue_chatgpt_conversation', 'get_chatgpt_turn']) {
      const hidden = await fetch(url, {
        method: 'POST',
        headers: { ...headers, Authorization: 'Bearer mcp-test-token' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 100,
          method: 'tools/call',
          params: { name, arguments: {} },
        }),
      })
      const hiddenEvent = (await hidden.text())
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice('data: '.length)
      const hiddenResult = JSON.parse(hiddenEvent)
      expect(hiddenResult.error || hiddenResult.result?.isError).toBeTruthy()
    }
    expect(creates).toBe(0)
    expect(conversationReads).toBe(0)
    expect((await fetch(url, { method: 'POST', headers, body })).status).toBe(401)
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, Authorization: 'Bearer mcp-test-token' },
      body,
    })
    expect(response.status).toBe(200)
    const raw = await response.text()
    const event = raw
      .split('\n')
      .find((line) => line.startsWith('data: '))
      ?.slice('data: '.length)
    const output = JSON.parse(event)
    expect(output.result.structuredContent).toMatchObject({
      conversation_id: 'conversation-1',
      message_id: 'message-1',
      status: 'completed',
      text: 'Final answer',
      thought_duration_seconds: 12,
    })
    expect(output.result.content[0].text).toBe('Final answer')
    expect(creates).toBe(1)
    expect(createdBodies[0]).toEqual({
      query:
        'Research something\n\n请直接以文本回答；如有参考链接，请附上链接。请不要创建文件、代码或图片，我的浏览器无法在当前页面打开或加载这些内容。',
    })
    expect(statusReads).toBe(3)
    expect(conversationReads).toBe(0)

    const callTool = async (id, name, args) => {
      const call = await fetch(url, {
        method: 'POST',
        headers: { ...headers, Authorization: 'Bearer mcp-test-token' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      })
      const event = (await call.text())
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice('data: '.length)
      return JSON.parse(event).result
    }
    holdTurns = true
    const activeCalls = Array.from({ length: 4 }, (_, index) =>
      callTool(index + 2, 'ask_chatgpt', { query: `Research topic ${index}` }),
    )
    await vi.waitFor(() => expect(creates).toBe(5))
    const rejected = await callTool(6, 'ask_chatgpt', { query: 'Research another topic' })
    expect(rejected.isError).toBe(true)
    expect(JSON.parse(rejected.content[0].text)).toMatchObject({
      code: 'concurrency_limit',
      error: expect.stringContaining('No message was sent'),
    })
    expect(creates).toBe(5)
    expect(conversationReads).toBe(0)

    holdTurns = false
    const completed = await Promise.all(activeCalls)
    completed.forEach((output) => expect(output.structuredContent?.status).toBe('completed'))
    const next = await callTool(7, 'ask_chatgpt', { query: 'Research next topic' })
    expect(next.structuredContent?.status).toBe('completed')
    expect(creates).toBe(6)
  }, 30_000)
})
