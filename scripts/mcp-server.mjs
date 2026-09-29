#!/usr/bin/env node
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node'
import { z } from 'zod'
import { loadOrCreateBridgeToken, timingSafeEquals } from './lib/bridge-auth.mjs'
import { isAllowedHost } from './lib/gateway-access.mjs'
import {
  createConversationGateway,
  createTurnCallLimiter,
  waitForFinalTurn,
} from './lib/mcp-conversations.mjs'

const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const port = Number(option('port', process.env.CHATGPT_MCP_PORT || 18081))
const host = option('host', process.env.CHATGPT_MCP_HOST || '127.0.0.1')
const gatewayPort = Number(option('gateway-port', process.env.CHATGPT_GATEWAY_PORT || 18080))
if (![port, gatewayPort].every((value) => Number.isInteger(value) && value > 0 && value < 65536)) {
  throw new Error('Invalid MCP or API gateway port')
}
if (!['127.0.0.1', '0.0.0.0'].includes(host)) {
  throw new Error('Invalid MCP host; use 127.0.0.1 or 0.0.0.0')
}
const tokenDir = path.join(os.homedir(), '.chatgptbox')
const mcpTokenFile = path.join(tokenDir, 'mcp-token')
const {
  token: mcpToken,
  fromFile: mcpTokenFromFile,
  generated: mcpTokenGenerated,
} = loadOrCreateBridgeToken({
  tokenFile: mcpTokenFile,
  configuredToken: option('token', process.env.CHATGPT_MCP_TOKEN),
})
if (mcpTokenGenerated && !mcpTokenFromFile) {
  throw new Error(`Could not save MCP token to ${mcpTokenFile}; set CHATGPT_MCP_TOKEN explicitly`)
}
let gatewayToken = process.env.CHATGPT_GATEWAY_API_TOKEN?.trim()
if (!gatewayToken) {
  try {
    gatewayToken = fs.readFileSync(path.join(tokenDir, 'gateway-api-token'), 'utf8').trim()
  } catch {
    throw new Error('Start the API gateway first, or set CHATGPT_GATEWAY_API_TOKEN')
  }
}
if (!gatewayToken) throw new Error('Gateway API token is empty')
const gateway = createConversationGateway({
  baseUrl: `http://127.0.0.1:${gatewayPort}`,
  token: gatewayToken,
})
const positiveNumber = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
const maxWaitMs = Math.min(
  7_200_000,
  Math.max(30_000, positiveNumber(process.env.CHATGPT_MCP_WAIT_SECONDS, 2700) * 1000),
)
const pollMs = Math.max(10, positiveNumber(process.env.CHATGPT_MCP_POLL_MS, 10_000))
const MAX_CONCURRENT_TURNS = 4
const withTurnSlot = createTurnCallLimiter(MAX_CONCURRENT_TURNS)
const serverInstructions = [
  'Ask ChatGPT as a capable peer agent, not as a search API or a subordinate research workflow.',
  'The user has already configured the ChatGPT Web model, thinking effort, custom instructions, memory, and personalization; do not try to override them.',
  'Use ask_chatgpt when its own judgment would materially help, including open-ended or deep questions. Do not leave it unused merely because another search tool exists.',
  'Pass one clear, natural question with only the context needed to understand it and what the user wants. For example: "关于 X，我已经知道 Y；我需要你 Z" or "深度调研：关于 X，我应该知道的一切". Put long background in a code block if helpful.',
  'Let ChatGPT decide how to investigate and answer. Do not prescribe a multi-step research plan, source quotas, or a model setting.',
  'Do not send keyword searches, trivial test questions, or connectivity checks; inspect the MCP tool list or local health instead.',
  'The server automatically requests a text answer with reference links when available and no files, code, or images.',
].join(' ')
const textOnlyResponseInstruction =
  '\n\n请直接以文本回答；如有参考链接，请附上链接。请不要创建文件、代码或图片，我的浏览器无法在当前页面打开或加载这些内容。'
const turnLimitDescription =
  'At most 4 calls may run concurrently. Above the limit, the call fails before sending a message; wait for an active call to finish.'

const input = {
  query: z
    .string()
    .trim()
    .min(1)
    .describe(
      'One clear question for ChatGPT. Include relevant background and what you need; keep ChatGPT free to decide how to answer. Long background may go in a code block.',
    ),
}
const result = (turn) => ({
  content: [{ type: 'text', text: turn.text }],
  structuredContent: {
    conversation_id: turn.conversationId,
    message_id: turn.messageId,
    status: 'completed',
    text: turn.text,
    thought_duration_seconds: turn.thoughtDurationSec ?? null,
  },
})
const failure = (error, ack) => ({
  isError: true,
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        error: error?.message || String(error),
        code: error?.code,
        http_status: error?.status,
        retryable: error?.retryable,
        conversation_id: ack?.conversationId,
        message_id: ack?.messageId,
        operation_id: error?.operationId,
      }),
    },
  ],
})

async function runTurn(ctx, send) {
  let ack
  try {
    return await withTurnSlot(async () => {
      ack = await send(ctx.mcpReq.signal)
      if (!ack?.conversationId || !ack?.messageId)
        throw new Error('API bridge returned no turn IDs')
      const progressToken = ctx.mcpReq._meta?.progressToken
      const turn = await waitForFinalTurn(gateway, {
        conversationId: ack.conversationId,
        messageId: ack.messageId,
        signal: ctx.mcpReq.signal,
        maxWaitMs,
        pollMs,
        onProgress: progressToken
          ? (progress) =>
              ctx.mcpReq.notify({
                method: 'notifications/progress',
                params: { progressToken, progress, message: 'Waiting for final ChatGPT answer' },
              })
          : undefined,
      })
      return result(turn)
    })
  } catch (error) {
    return failure(error, ack)
  }
}

const handler = createMcpHandler(
  () => {
    const server = new McpServer(
      { name: 'chatgptbox-conversations', version: '1.0.0' },
      { instructions: serverInstructions },
    )
    server.registerTool(
      'ask_chatgpt',
      {
        description: `Ask the user's personalized ChatGPT Web one clear question and return its final text answer. It uses the account's existing model, thinking settings, custom instructions, and memory. Give necessary background and say what you need, then let ChatGPT decide how to investigate and respond; do not script its research process. Use when its judgment would help, not for keyword search or trivial tests. The server asks for reference links when available and requests no files, code, or images. Structured output includes reported thinking time when available. ${turnLimitDescription}`,
        inputSchema: z.object(input).strict(),
      },
      (args, ctx) =>
        runTurn(ctx, (signal) =>
          gateway.create(
            {
              query: args.query + textOnlyResponseInstruction,
            },
            signal,
          ),
        ),
    )
    return server
  },
  { responseMode: 'sse', keepAliveMs: 15_000 },
)
const nodeHandler = toNodeHandler(handler)
const validateLocalhost = localhostHostValidation()
const validateHost = (req, res) => {
  if (host === '127.0.0.1') return validateLocalhost(req, res)
  if (isAllowedHost(req.headers.host, host, port)) return true
  res.writeHead(403, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Invalid Host header' }))
  return false
}
const validateOrigin = localhostOriginValidation()
const server = http.createServer((req, res) => {
  if (!validateHost(req, res) || !validateOrigin(req, res)) return
  if (req.url !== '/mcp') {
    res.writeHead(404).end()
    return
  }
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1]
  if (!bearer || !timingSafeEquals(bearer, mcpToken)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Bearer', 'Cache-Control': 'no-store' }).end()
    return
  }
  void nodeHandler(req, res)
})
server.requestTimeout = 0
server.listen(port, host, () => {
  console.log(`ChatGPTBox MCP: http://${host}:${port}/mcp`)
  console.log(
    `MCP bearer token: ${mcpTokenFromFile ? mcpTokenFile : 'configured via CLI/environment'}`,
  )
})
