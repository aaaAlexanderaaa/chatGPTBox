import { getSelectedMcpServers, getSelectedSkills } from '../agent-context.mjs'
import { callMcpTool, listMcpTools } from './http-transport.mjs'
import { AgentProtocol } from '../agent/protocols.mjs'
import { addAgentMemoryStep, updateAgentMemory } from '../agent/session-state.mjs'
import { shouldShortCircuitWithToolLoop, toToolAlias } from '../agent/runtime-utils.mjs'
import { resolvePromptTemplate } from '../../utils/prompt-template-context.mjs'

const DEFAULT_MAX_TURNS = 6
const DEFAULT_NO_PROGRESS_LIMIT = 2
const MAX_TOOL_RESULT_CHARS = 24000
const TOOL_CATALOG_CACHE_TTL_MS = 60000
const MAX_BUILTIN_SKILL_DETAIL_CHARS = 12000

const BuiltInMcpServerIds = {
  skillLibrary: 'mcp-builtin-skill-library',
  browserContextToolkit: 'mcp-builtin-browser-context-toolkit',
}

const toolCatalogCache = new Map()

function nowIso() {
  return new Date().toISOString()
}

function normalizeToolSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} }
  }
  if (schema.type) return schema
  return { ...schema, type: 'object' }
}

function buildToolMessageContent(result) {
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

function extractAssistantContent(message) {
  if (!message) return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part.text === 'string') return part.text
        if (part && typeof part.output_text === 'string') return part.output_text
        return ''
      })
      .join('')
  }
  return ''
}

function getCatalogCacheKey(server) {
  const id = String(server?.id || '')
  const url = String(server?.httpUrl || '')
  return `${id}|${url}`
}

function getCachedTools(server) {
  const key = getCatalogCacheKey(server)
  const cached = toolCatalogCache.get(key)
  if (!cached) return null
  if (Date.now() - cached.cachedAt > TOOL_CATALOG_CACHE_TTL_MS) {
    toolCatalogCache.delete(key)
    return null
  }
  return cached.tools
}

function setCachedTools(server, tools) {
  const key = getCatalogCacheKey(server)
  toolCatalogCache.set(key, {
    tools: Array.isArray(tools) ? tools : [],
    cachedAt: Date.now(),
  })
}

async function listToolsWithCache(server, options = {}) {
  const cached = getCachedTools(server)
  if (cached) {
    return { tools: cached, fromCache: true }
  }
  const listed = await listMcpTools(server, options)
  setCachedTools(server, listed)
  return { tools: listed, fromCache: false }
}

function clampMaxChars(value, fallback, max = MAX_BUILTIN_SKILL_DETAIL_CHARS) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(200, Math.min(max, Math.floor(parsed)))
}

function safeJsonParse(value, fallback = {}) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function renderSkillTemplate(text, session, config, maxChars = MAX_BUILTIN_SKILL_DETAIL_CHARS) {
  const source = typeof text === 'string' ? text : ''
  if (!source.trim()) return ''
  try {
    const rendered = resolvePromptTemplate(source, {
      pageContext: session?.pageContext || null,
      preloadTokenCap: config?.agentPreloadContextTokenCap,
      contextTokenCap: config?.agentContextTokenCap,
      allowFullHtml: false,
    })
    return String(rendered || '').slice(0, maxChars)
  } catch {
    return source.slice(0, maxChars)
  }
}

function summarizePageContextForTool(session, maxChars) {
  const pageContext = session?.pageContext
  if (!pageContext || typeof pageContext !== 'object') {
    return { available: false, reason: 'Page context is unavailable for this session.' }
  }

  const summary = {
    available: true,
    capturedAt: pageContext.capturedAt || '',
    url: pageContext.url || '',
    title: pageContext.title || '',
    description: pageContext.description || '',
    language: pageContext.language || '',
    extractionMethod: pageContext.extraction?.method || '',
    contentSnippet: String(pageContext.content || '').slice(0, maxChars),
    styleSummary: String(pageContext.styleSummary || '').slice(0, maxChars),
  }
  return summary
}

function readPageContextFieldForTool(session, field, maxChars) {
  const pageContext = session?.pageContext
  if (!pageContext || typeof pageContext !== 'object') {
    return { available: false, reason: 'Page context is unavailable for this session.' }
  }
  const key = String(field || '').trim()
  if (!key) return { error: 'field is required' }

  const value = pageContext[key]
  if (value == null) return { field: key, value: '' }
  if (typeof value === 'string') return { field: key, value: value.slice(0, maxChars) }
  if (typeof value === 'number' || typeof value === 'boolean') return { field: key, value }
  return { field: key, value: JSON.stringify(value).slice(0, maxChars) }
}

function buildSkillDetailPayload(skill, args, session, config) {
  const section = String(args?.section || 'overview').trim().toLowerCase()
  const maxChars = clampMaxChars(args?.max_chars ?? args?.maxChars, 6000, MAX_BUILTIN_SKILL_DETAIL_CHARS)

  if (section === 'overview') {
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description || '',
      version: skill.version || '',
      sourceName: skill.sourceName || '',
      entryPath: skill.entryPath || '',
      resourceCount: Array.isArray(skill.resources) ? skill.resources.length : 0,
      resourcePaths: (Array.isArray(skill.resources) ? skill.resources : [])
        .map((resource) => resource?.path)
        .filter(Boolean),
    }
  }

  if (section === 'instructions') {
    return {
      id: skill.id,
      name: skill.name,
      section: 'instructions',
      content: renderSkillTemplate(skill.instructions || '', session, config, maxChars),
    }
  }

  if (section === 'resources_index') {
    return {
      id: skill.id,
      name: skill.name,
      section: 'resources_index',
      resources: (Array.isArray(skill.resources) ? skill.resources : [])
        .map((resource) => resource?.path)
        .filter(Boolean),
    }
  }

  if (section === 'resource') {
    const requestedPath = String(args?.resource_path || args?.resourcePath || '').trim()
    const resources = Array.isArray(skill.resources) ? skill.resources : []
    const resource =
      resources.find((item) => item?.path === requestedPath) ||
      resources.find((item) => item?.path && item.path.endsWith(requestedPath))
    if (!resource) {
      return {
        id: skill.id,
        name: skill.name,
        section: 'resource',
        error: requestedPath
          ? `Resource not found: ${requestedPath}`
          : 'resource_path is required for section="resource"',
      }
    }
    return {
      id: skill.id,
      name: skill.name,
      section: 'resource',
      path: resource.path,
      content: renderSkillTemplate(resource.content || '', session, config, maxChars),
    }
  }

  return {
    id: skill.id,
    name: skill.name,
    error:
      'Invalid section. Supported values: overview, instructions, resources_index, resource.',
  }
}

function getBuiltInServerToolDefinitions(server, options = {}) {
  if (!server || typeof server !== 'object') return []

  if (server.id === BuiltInMcpServerIds.skillLibrary) {
    const selectedSkills = Array.isArray(options.selectedSkills) ? options.selectedSkills : []
    return selectedSkills.map((skill) => ({
      kind: 'builtin_skill',
      remoteName: `skill_detail_${skill.id}`,
      skill,
      description:
        `Read progressive details for skill "${skill.name}" only when needed. ` +
        'Use section=overview|instructions|resources_index|resource.',
      parameters: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            enum: ['overview', 'instructions', 'resources_index', 'resource'],
          },
          resource_path: { type: 'string' },
          max_chars: { type: 'integer', minimum: 200, maximum: MAX_BUILTIN_SKILL_DETAIL_CHARS },
        },
        required: ['section'],
      },
    }))
  }

  if (server.id === BuiltInMcpServerIds.browserContextToolkit) {
    return [
      {
        kind: 'builtin_page_context',
        action: 'overview',
        remoteName: 'page_context_overview',
        description: 'Return a compact overview of captured page context for the current tab.',
        parameters: {
          type: 'object',
          properties: {
            max_chars: { type: 'integer', minimum: 200, maximum: MAX_BUILTIN_SKILL_DETAIL_CHARS },
          },
        },
      },
      {
        kind: 'builtin_page_context',
        action: 'field',
        remoteName: 'page_context_field',
        description: 'Read a specific top-level field from captured page context.',
        parameters: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            max_chars: { type: 'integer', minimum: 200, maximum: MAX_BUILTIN_SKILL_DETAIL_CHARS },
          },
          required: ['field'],
        },
      },
      {
        kind: 'builtin_page_context',
        action: 'resolve_template',
        remoteName: 'page_context_resolve_template',
        description:
          'Resolve prompt template variables against captured page context (no full HTML expansion).',
        parameters: {
          type: 'object',
          properties: {
            template: { type: 'string' },
            max_chars: { type: 'integer', minimum: 200, maximum: MAX_BUILTIN_SKILL_DETAIL_CHARS },
          },
          required: ['template'],
        },
      },
    ]
  }

  return []
}

async function collectToolCatalog(servers, options = {}) {
  const tools = []
  const toolMap = new Map()
  const events = []
  let aliasIndex = 0
  const hasExplicitSkillLibrary = (Array.isArray(servers) ? servers : []).some(
    (server) => server?.id === BuiltInMcpServerIds.skillLibrary,
  )

  for (const server of servers) {
    try {
      let listed = []
      let fromCache = false
      let isBuiltIn = false

      if (server?.transport === 'builtin') {
        listed = getBuiltInServerToolDefinitions(server, options).map((tool) => ({
          name: tool.remoteName,
          description: tool.description,
          inputSchema: tool.parameters,
          kind: tool.kind,
          skill: tool.skill,
          action: tool.action,
        }))
        isBuiltIn = true
      } else {
        const listedResult = await listToolsWithCache(server, options)
        listed = listedResult.tools
        fromCache = listedResult.fromCache
      }

      for (const remoteTool of listed) {
        if (!remoteTool || typeof remoteTool !== 'object') continue
        const remoteName = String(remoteTool.name || '').trim()
        if (!remoteName) continue

        aliasIndex += 1
        let alias = toToolAlias(server.id, remoteName, aliasIndex)
        while (toolMap.has(alias)) {
          aliasIndex += 1
          alias = toToolAlias(server.id, remoteName, aliasIndex)
        }

        toolMap.set(alias, {
          kind: remoteTool.kind || 'mcp_http',
          server,
          remoteName,
          skill: remoteTool.skill,
          action: remoteTool.action,
        })
        tools.push({
          type: 'function',
          function: {
            name: alias,
            description:
              String(remoteTool.description || '').trim() ||
              `MCP tool "${remoteName}" from "${server.name}"`,
            parameters: normalizeToolSchema(remoteTool.inputSchema || remoteTool.parameters),
          },
        })
      }
      events.push({
        type: 'mcp_tools_listed',
        status: 'succeeded',
        source: isBuiltIn ? 'builtin' : fromCache ? 'cache' : 'server',
        serverId: server.id,
        serverName: server.name,
        toolCount: listed.length,
        createdAt: nowIso(),
      })
    } catch (error) {
      events.push({
        type: 'mcp_tools_listed',
        status: 'failed',
        serverId: server.id,
        serverName: server.name,
        error: error?.message || String(error),
        createdAt: nowIso(),
      })
    }
  }

  const selectedSkills = Array.isArray(options.selectedSkills) ? options.selectedSkills : []
  if (!hasExplicitSkillLibrary && selectedSkills.length > 0) {
    const listed = getBuiltInServerToolDefinitions(
      { id: BuiltInMcpServerIds.skillLibrary, name: 'Skill Library (Built-in)' },
      { selectedSkills },
    )
    for (const remoteTool of listed) {
      const remoteName = String(remoteTool.remoteName || '').trim()
      if (!remoteName) continue

      aliasIndex += 1
      let alias = toToolAlias(BuiltInMcpServerIds.skillLibrary, remoteName, aliasIndex)
      while (toolMap.has(alias)) {
        aliasIndex += 1
        alias = toToolAlias(BuiltInMcpServerIds.skillLibrary, remoteName, aliasIndex)
      }

      toolMap.set(alias, {
        kind: remoteTool.kind || 'builtin_skill',
        server: {
          id: BuiltInMcpServerIds.skillLibrary,
          name: 'Skill Library (Built-in)',
          transport: 'builtin',
        },
        remoteName,
        skill: remoteTool.skill,
      })
      tools.push({
        type: 'function',
        function: {
          name: alias,
          description: String(remoteTool.description || '').trim() || remoteName,
          parameters: normalizeToolSchema(remoteTool.parameters),
        },
      })
    }

    events.push({
      type: 'mcp_tools_listed',
      status: 'succeeded',
      source: 'implicit',
      serverId: BuiltInMcpServerIds.skillLibrary,
      serverName: 'Skill Library (Built-in)',
      toolCount: listed.length,
      createdAt: nowIso(),
    })
  }

  return { tools, toolMap, events }
}

function buildAuthHeaders(apiKey, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  }
  const token = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function postJson(url, { headers = {}, body = {}, signal }) {
  const response = await fetch(url, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Tool loop request failed: ${response.status} ${response.statusText}\n${text}`)
  }
  return response.json()
}

function toAnthropicTools(catalogTools) {
  return (Array.isArray(catalogTools) ? catalogTools : []).map((tool) => ({
    name: tool?.function?.name,
    description: tool?.function?.description || '',
    input_schema: normalizeToolSchema(tool?.function?.parameters),
  }))
}

function convertMessagesToResponsesInput(messages) {
  const input = []
  let instructions = ''

  for (const message of Array.isArray(messages) ? messages : []) {
    const role = String(message?.role || '')
    const content = extractAssistantContent(message)
    if (!content) continue

    if (role === 'system') {
      instructions = instructions ? `${instructions}\n\n${content}` : content
      continue
    }

    if (role === 'user' || role === 'assistant') {
      input.push({
        role,
        content: [{ type: 'input_text', text: content }],
      })
    }
  }

  return { input, instructions }
}

function extractResponsesAnswer(payload) {
  const outputText = typeof payload?.output_text === 'string' ? payload.output_text.trim() : ''
  if (outputText) return outputText

  const output = Array.isArray(payload?.output) ? payload.output : []
  const lines = []

  for (const item of output) {
    if (item?.type !== 'message') continue
    const content = Array.isArray(item.content) ? item.content : []
    for (const part of content) {
      if (typeof part?.text === 'string' && part.text.trim()) lines.push(part.text)
      if (typeof part?.output_text === 'string' && part.output_text.trim()) lines.push(part.output_text)
    }
  }

  return lines.join('\n').trim()
}

function extractResponsesToolCalls(payload) {
  const toolCalls = []
  const output = Array.isArray(payload?.output) ? payload.output : []

  for (const item of output) {
    if (item?.type !== 'function_call') continue
    const name = String(item.name || item.function?.name || '').trim()
    if (!name) continue
    const id = String(item.call_id || item.id || `${name}_${toolCalls.length + 1}`)

    let argumentsText = '{}'
    if (typeof item.arguments === 'string') argumentsText = item.arguments
    else if (item.arguments && typeof item.arguments === 'object') {
      try {
        argumentsText = JSON.stringify(item.arguments)
      } catch {
        argumentsText = '{}'
      }
    }

    toolCalls.push({
      id,
      function: {
        name,
        arguments: argumentsText,
      },
    })
  }

  return toolCalls
}

function extractAnthropicAnswer(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : []
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim()
}

function extractAnthropicToolCalls(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : []
  return blocks
    .filter((block) => block?.type === 'tool_use' && block?.name)
    .map((block) => ({
      id: String(block.id || `${block.name}_${Math.random().toString(16).slice(2, 6)}`),
      function: {
        name: String(block.name || ''),
        arguments:
          typeof block.input === 'string'
            ? block.input
            : (() => {
                try {
                  return JSON.stringify(block.input || {})
                } catch {
                  return '{}'
                }
              })(),
      },
      raw: block,
    }))
}

function cloneMessages(messages) {
  return Array.isArray(messages) ? messages.map((message) => ({ ...message })) : []
}

function readNoProgressLimit(config) {
  const parsed = Number(config?.agentNoProgressLimit)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_NO_PROGRESS_LIMIT
  return Math.floor(parsed)
}

function readMaxTurns(config) {
  const parsed = Number(config?.agentMaxSteps)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_TURNS
  return Math.floor(parsed)
}

async function executeToolCalls({
  toolCalls,
  catalog,
  loopMessages,
  requireHttps,
  signal,
  session,
  config,
  turn,
  protocol,
  anthropicAssistantContent,
}) {
  const events = []
  const toolOutputsForResponses = []
  const anthropicToolResults = []

  for (const toolCall of toolCalls) {
    const alias = toolCall?.function?.name
    const mapping = catalog.toolMap.get(alias)
    if (!mapping) {
      const unsupportedContent = `Unknown tool alias: ${alias || '(missing alias)'}`
      events.push({
        type: 'mcp_tool_call',
        status: 'failed',
        reason: unsupportedContent,
        turn,
        createdAt: nowIso(),
      })

      if (protocol === AgentProtocol.openAiChatCompletionsV1) {
        loopMessages.push({
          role: 'tool',
          tool_call_id: toolCall?.id,
          content: unsupportedContent,
        })
      }

      if (protocol === AgentProtocol.anthropicMessagesV1) {
        anthropicToolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall?.id,
          content: unsupportedContent,
        })
      }

      if (protocol === AgentProtocol.openAiResponsesV1) {
        toolOutputsForResponses.push({
          type: 'function_call_output',
          call_id: toolCall?.id,
          output: unsupportedContent,
        })
      }
      continue
    }

    const rawArguments = toolCall?.function?.arguments
    const args = rawArguments ? safeJsonParse(rawArguments, {}) : {}

    try {
      let result
      if (mapping.kind === 'builtin_skill') {
        result = buildSkillDetailPayload(mapping.skill, args, session, config)
      } else if (mapping.kind === 'builtin_page_context') {
        const maxChars = clampMaxChars(
          args?.max_chars ?? args?.maxChars,
          6000,
          MAX_BUILTIN_SKILL_DETAIL_CHARS,
        )
        if (mapping.action === 'overview') {
          result = summarizePageContextForTool(session, maxChars)
        } else if (mapping.action === 'field') {
          result = readPageContextFieldForTool(session, args?.field, maxChars)
        } else if (mapping.action === 'resolve_template') {
          const template = String(args?.template || '')
          result = {
            resolved: resolvePromptTemplate(template, {
              pageContext: session?.pageContext || null,
              preloadTokenCap: config?.agentPreloadContextTokenCap,
              contextTokenCap: config?.agentContextTokenCap,
              allowFullHtml: false,
            }).slice(0, maxChars),
          }
        } else {
          result = { error: `Unsupported built-in action: ${mapping.action || 'unknown'}` }
        }
      } else {
        result = await callMcpTool(mapping.server, mapping.remoteName, args, {
          requireHttps,
          signal,
        })
      }
      const content = buildToolMessageContent(result).slice(0, MAX_TOOL_RESULT_CHARS)

      if (protocol === AgentProtocol.openAiChatCompletionsV1) {
        loopMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content,
        })
      }

      if (protocol === AgentProtocol.anthropicMessagesV1) {
        anthropicToolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content,
        })
      }

      if (protocol === AgentProtocol.openAiResponsesV1) {
        toolOutputsForResponses.push({
          type: 'function_call_output',
          call_id: toolCall.id,
          output: content,
        })
      }

      events.push({
        type: 'mcp_tool_call',
        status: 'succeeded',
        turn,
        serverId: mapping.server.id,
        serverName: mapping.server.name,
        toolName: mapping.remoteName,
        args,
        createdAt: nowIso(),
      })
    } catch (error) {
      const content = `Tool call failed: ${error?.message || String(error)}`

      if (protocol === AgentProtocol.openAiChatCompletionsV1) {
        loopMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content,
        })
      }

      if (protocol === AgentProtocol.anthropicMessagesV1) {
        anthropicToolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content,
        })
      }

      if (protocol === AgentProtocol.openAiResponsesV1) {
        toolOutputsForResponses.push({
          type: 'function_call_output',
          call_id: toolCall.id,
          output: content,
        })
      }

      events.push({
        type: 'mcp_tool_call',
        status: 'failed',
        turn,
        serverId: mapping.server.id,
        serverName: mapping.server.name,
        toolName: mapping.remoteName,
        args,
        error: error?.message || String(error),
        createdAt: nowIso(),
      })
    }
  }

  if (protocol === AgentProtocol.anthropicMessagesV1 && anthropicToolResults.length > 0) {
    loopMessages.push({ role: 'assistant', content: anthropicAssistantContent })
    loopMessages.push({ role: 'user', content: anthropicToolResults })
  }

  return {
    events,
    toolOutputsForResponses,
  }
}

async function runOpenAiChatTurn({
  baseUrl,
  apiKey,
  model,
  loopMessages,
  catalog,
  maxResponseTokenLength,
  temperature,
  extraBody,
  signal,
}) {
  const body = {
    ...extraBody,
    model,
    messages: loopMessages,
    tools: catalog.tools,
    tool_choice: 'auto',
    max_tokens: maxResponseTokenLength,
    temperature,
    stream: false,
  }

  const payload = await postJson(`${baseUrl}/chat/completions`, {
    headers: buildAuthHeaders(apiKey),
    body,
    signal,
  })

  const choice = payload?.choices?.[0]
  const message = choice?.message
  if (!message) {
    return {
      answer: '',
      toolCalls: [],
      modelMessage: null,
      status: 'failed',
      reason: 'missing_message',
    }
  }

  return {
    answer: extractAssistantContent(message).trim(),
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
    modelMessage: message,
    status: 'ok',
  }
}

async function runOpenAiResponsesTurn({
  baseUrl,
  apiKey,
  model,
  input,
  previousResponseId,
  instructions,
  catalog,
  maxResponseTokenLength,
  temperature,
  extraBody,
  signal,
}) {
  const body = {
    ...extraBody,
    model,
    input,
    tools: catalog.tools.map((tool) => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    })),
    tool_choice: 'auto',
    max_output_tokens: maxResponseTokenLength,
    temperature,
    store: false,
  }

  if (previousResponseId) body.previous_response_id = previousResponseId
  if (!previousResponseId && instructions) body.instructions = instructions

  const payload = await postJson(`${baseUrl}/responses`, {
    headers: buildAuthHeaders(apiKey),
    body,
    signal,
  })

  return {
    answer: extractResponsesAnswer(payload),
    toolCalls: extractResponsesToolCalls(payload),
    responseId: payload?.id || previousResponseId,
    modelMessage: payload,
    status: 'ok',
  }
}

async function runAnthropicTurn({
  baseUrl,
  apiKey,
  model,
  loopMessages,
  systemPrompt,
  catalog,
  maxResponseTokenLength,
  temperature,
  extraBody,
  signal,
}) {
  const body = {
    ...extraBody,
    model,
    messages: loopMessages,
    tools: toAnthropicTools(catalog.tools),
    tool_choice: { type: 'auto' },
    max_tokens: maxResponseTokenLength,
    temperature,
  }
  if (typeof systemPrompt === 'string' && systemPrompt) {
    body.system = systemPrompt
  }

  const payload = await postJson(`${baseUrl}/messages`, {
    headers: {
      ...buildAuthHeaders('', {
        'anthropic-version': '2023-06-01',
        'x-api-key': String(apiKey || ''),
        'anthropic-dangerous-direct-browser-access': true,
      }),
    },
    body,
    signal,
  })

  return {
    answer: extractAnthropicAnswer(payload),
    toolCalls: extractAnthropicToolCalls(payload),
    modelMessage: payload,
    anthropicAssistantContent: payload?.content,
    status: 'ok',
  }
}

function buildResult(status, reason, answer, usedTools, events, turns) {
  return {
    status,
    reason,
    answer: typeof answer === 'string' ? answer : '',
    usedTools: usedTools === true,
    events: Array.isArray(events) ? events : [],
    turns: Number.isFinite(turns) ? turns : 0,
  }
}

export async function runMcpToolLoop({
  protocol,
  baseUrl,
  apiKey,
  model,
  messages,
  systemPrompt,
  config,
  session,
  maxResponseTokenLength,
  temperature,
  extraBody = {},
  signal,
}) {
  const selectedSkills = getSelectedSkills(session, config)
  const selectedServers = getSelectedMcpServers(session, config).filter((server) => {
    if (server.transport === 'builtin') return true
    return server.transport === 'http' && server.httpUrl
  })
  if (selectedServers.length === 0 && selectedSkills.length === 0) return null

  const requireHttps = config?.runtimeMode !== 'developer'
  const catalog = await collectToolCatalog(selectedServers, {
    requireHttps,
    signal,
    selectedSkills,
  })
  if (catalog.tools.length === 0) {
    const result = buildResult('failed', 'no_tools_available', '', false, catalog.events, 0)
    updateAgentMemory(session, {
      objective: String(messages?.[messages.length - 1]?.content || '').slice(0, 400),
      lastStopReason: result.reason,
      nextAction: 'fallback_to_standard_completion',
    })
    return result
  }

  const normalizedProtocol =
    protocol === AgentProtocol.openAiResponsesV1 ||
    protocol === AgentProtocol.anthropicMessagesV1 ||
    protocol === AgentProtocol.openAiChatCompletionsV1
      ? protocol
      : AgentProtocol.openAiChatCompletionsV1

  const events = [...catalog.events]
  const maxTurns = readMaxTurns(config)
  const noProgressLimit = readNoProgressLimit(config)
  let noProgressCount = 0
  let turns = 0
  let usedTools = false
  let assistantAnswer = ''

  const loopMessages = cloneMessages(messages)
  let responseInput = []
  let previousResponseId = null
  let responseInstructions = ''
  if (normalizedProtocol === AgentProtocol.openAiResponsesV1) {
    const converted = convertMessagesToResponsesInput(loopMessages)
    responseInput = converted.input
    responseInstructions = converted.instructions || (typeof systemPrompt === 'string' ? systemPrompt : '')
  }

  updateAgentMemory(session, {
    objective: String(loopMessages?.[loopMessages.length - 1]?.content || '').slice(0, 400),
    nextAction: 'tool_loop',
    noProgressCount: 0,
    lastStopReason: '',
  })

  for (let turn = 0; turn < maxTurns; turn += 1) {
    turns = turn + 1
    addAgentMemoryStep(session, {
      type: 'plan',
      status: 'in_progress',
      detail: `Turn ${turn + 1}: request model action`,
      createdAt: nowIso(),
    })

    let turnResult
    if (normalizedProtocol === AgentProtocol.openAiResponsesV1) {
      turnResult = await runOpenAiResponsesTurn({
        baseUrl,
        apiKey,
        model,
        input: responseInput,
        previousResponseId,
        instructions: responseInstructions,
        catalog,
        maxResponseTokenLength,
        temperature,
        extraBody,
        signal,
      })
    } else if (normalizedProtocol === AgentProtocol.anthropicMessagesV1) {
      turnResult = await runAnthropicTurn({
        baseUrl,
        apiKey,
        model,
        loopMessages,
        systemPrompt,
        catalog,
        maxResponseTokenLength,
        temperature,
        extraBody,
        signal,
      })
    } else {
      turnResult = await runOpenAiChatTurn({
        baseUrl,
        apiKey,
        model,
        loopMessages,
        catalog,
        maxResponseTokenLength,
        temperature,
        extraBody,
        signal,
      })
    }

    if (turnResult.status !== 'ok') {
      events.push({
        type: 'mcp_tool_loop',
        status: 'failed',
        reason: turnResult.reason || 'turn_failed',
        turn,
        createdAt: nowIso(),
      })
      const failure = buildResult('failed', turnResult.reason || 'turn_failed', '', usedTools, events, turns)
      updateAgentMemory(session, {
        lastStopReason: failure.reason,
        nextAction: 'fallback_to_standard_completion',
        noProgressCount,
      })
      return failure
    }

    if (normalizedProtocol === AgentProtocol.openAiChatCompletionsV1 && turnResult.modelMessage) {
      loopMessages.push(turnResult.modelMessage)
    }

    if (normalizedProtocol === AgentProtocol.openAiResponsesV1 && turnResult.responseId) {
      previousResponseId = turnResult.responseId
    }

    assistantAnswer = String(turnResult.answer || '').trim()
    const toolCalls = Array.isArray(turnResult.toolCalls) ? turnResult.toolCalls : []

    if (toolCalls.length === 0) {
      if (assistantAnswer) {
        events.push({
          type: 'mcp_tool_loop',
          status: 'succeeded',
          reason: 'completed',
          turn,
          toolCalls: 0,
          usedTools,
          createdAt: nowIso(),
        })
        const success = buildResult('succeeded', 'completed', assistantAnswer, usedTools, events, turns)
        updateAgentMemory(session, {
          lastStopReason: success.reason,
          nextAction: 'done',
          noProgressCount: 0,
        })
        addAgentMemoryStep(session, {
          type: 'evaluate',
          status: 'succeeded',
          detail: `Turn ${turn + 1}: completed without additional tool calls`,
          createdAt: nowIso(),
        })
        return success
      }

      noProgressCount += 1
      events.push({
        type: 'mcp_tool_loop',
        status: 'failed',
        reason: 'no_assistant_output',
        turn,
        noProgressCount,
        createdAt: nowIso(),
      })
      updateAgentMemory(session, {
        noProgressCount,
        nextAction: 'retry_or_fallback',
      })

      if (noProgressCount >= noProgressLimit) {
        const failure = buildResult(
          'failed',
          'no_progress_limit_exceeded',
          assistantAnswer,
          usedTools,
          events,
          turns,
        )
        updateAgentMemory(session, {
          lastStopReason: failure.reason,
          nextAction: 'fallback_to_standard_completion',
          noProgressCount,
        })
        return failure
      }
      continue
    }

    usedTools = true
    noProgressCount = 0
    addAgentMemoryStep(session, {
      type: 'act',
      status: 'in_progress',
      detail: `Turn ${turn + 1}: executing ${toolCalls.length} tool call(s)`,
      createdAt: nowIso(),
    })

    const { events: toolEvents, toolOutputsForResponses } = await executeToolCalls({
      toolCalls,
      catalog,
      loopMessages,
      requireHttps,
      signal,
      session,
      config,
      turn,
      protocol: normalizedProtocol,
      anthropicAssistantContent: turnResult.anthropicAssistantContent,
    })
    events.push(...toolEvents)

    if (normalizedProtocol === AgentProtocol.openAiResponsesV1) {
      responseInput = toolOutputsForResponses
    }
  }

  events.push({
    type: 'mcp_tool_loop',
    status: 'failed',
    reason: 'max_turns_exceeded',
    createdAt: nowIso(),
  })

  const timeoutResult = buildResult(
    'failed',
    'max_turns_exceeded',
    assistantAnswer,
    usedTools,
    events,
    turns,
  )
  updateAgentMemory(session, {
    lastStopReason: timeoutResult.reason,
    nextAction: 'fallback_to_standard_completion',
    noProgressCount,
  })
  addAgentMemoryStep(session, {
    type: 'evaluate',
    status: 'failed',
    detail: 'Agent stopped because max step limit was reached',
    createdAt: nowIso(),
  })
  return timeoutResult
}

export async function runMcpToolLoopForOpenAiCompat(options) {
  return runMcpToolLoop({ ...options, protocol: options?.protocol || AgentProtocol.openAiChatCompletionsV1 })
}

export async function runMcpToolLoopForAnthropic(options) {
  return runMcpToolLoop({ ...options, protocol: AgentProtocol.anthropicMessagesV1 })
}

export { toToolAlias, shouldShortCircuitWithToolLoop }
