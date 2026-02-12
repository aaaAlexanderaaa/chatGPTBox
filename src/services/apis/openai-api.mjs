// api version

import { getUserConfig } from '../../config/index.mjs'
import { fetchSSE } from '../../utils/fetch-sse.mjs'
import { getConversationPairs } from '../../utils/get-conversation-pairs.mjs'
import { isEmpty } from 'lodash-es'
import { getCompletionPromptBase, pushRecord, setAbortController } from './shared.mjs'
import { getModelValue, isUsingReasoningModel } from '../../utils/model-name-convert.mjs'
import { buildFallbackQuestionWithContext, buildSystemPromptFromContext } from '../agent-context.mjs'
import { runMcpToolLoopForOpenAiCompat, shouldShortCircuitWithToolLoop } from '../mcp/tool-loop.mjs'
import { appendToolEvents } from '../agent/session-state.mjs'
import { AgentProtocol, resolveOpenAiCompatibleProtocol } from '../agent/protocols.mjs'
import {
  convertMessagesToResponsesInput,
  extractResponsesOutputText,
  postOpenAiResponses,
} from './openai-responses-shared.mjs'

/**
 * Extract content from structured response arrays for reasoning models
 * @param {Array} contentArray - Array of content segments
 * @returns {string} - Extracted text content
 */
function extractContentFromArray(contentArray) {
  if (!Array.isArray(contentArray)) {
    console.debug('Content is not an array, returning empty string')
    return ''
  }

  try {
    const parts = contentArray
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          // Prefer output_text segments; fallback to text property
          if (typeof part.output_text === 'string') return part.output_text
          if (typeof part.text === 'string') return part.text
        }
        return ''
      })
      .filter(Boolean)

    return parts.join('')
  } catch (error) {
    console.error('Error extracting content from array:', error)
    return ''
  }
}

async function requestWithResponsesApi({
  baseUrl,
  apiKey,
  model,
  messages,
  maxResponseTokenLength,
  temperature,
  extraBody = {},
  signal,
}) {
  const converted = convertMessagesToResponsesInput(messages)
  const body = {
    ...extraBody,
    model,
    input: converted.input,
    max_output_tokens: maxResponseTokenLength,
    temperature,
    store: false,
  }
  if (converted.instructions) body.instructions = converted.instructions
  const payload = await postOpenAiResponses(baseUrl, apiKey, body, signal)
  return extractResponsesOutputText(payload)
}

/**
 * @param {Browser.Runtime.Port} port
 * @param {string} question
 * @param {Session} session
 * @param {string} apiKey
 */
export async function generateAnswersWithGptCompletionApi(port, question, session, apiKey) {
  const { controller, messageListener, disconnectListener } = setAbortController(port)
  const model = getModelValue(session)

  const config = await getUserConfig()
  const systemPrompt = buildSystemPromptFromContext(session, config, question)
  const prompt =
    (await getCompletionPromptBase()) +
    getConversationPairs(
      session.conversationRecords.slice(-config.maxConversationContextLength),
      true,
      { systemPrompt },
    ) +
    `Human: ${question}\nAI: `
  const apiUrl = config.customOpenAiApiUrl

  let answer = ''
  let finished = false
  const finish = () => {
    finished = true
    pushRecord(session, question, answer)
    console.debug('conversation history', { content: session.conversationRecords })
    port.postMessage({ answer: null, done: true, session: session })
  }
  await fetchSSE(`${apiUrl}/v1/completions`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      prompt: prompt,
      model,
      stream: true,
      max_tokens: config.maxResponseTokenLength,
      temperature: config.temperature,
      stop: '\nHuman',
    }),
    onMessage(message) {
      console.debug('sse message', message)
      if (finished) return
      if (message.trim() === '[DONE]') {
        finish()
        return
      }
      let data
      try {
        data = JSON.parse(message)
      } catch (error) {
        console.debug('json error', error)
        return
      }

      const choice = data.choices?.[0]
      if (!choice) {
        console.debug('No choice in response data')
        return
      }

      answer += choice.text
      port.postMessage({ answer: answer, done: false, session: null })

      if (choice.finish_reason) {
        finish()
        return
      }
    },
    async onStart() {},
    async onEnd() {
      port.postMessage({ done: true })
      port.onMessage.removeListener(messageListener)
      port.onDisconnect.removeListener(disconnectListener)
    },
    async onError(resp) {
      port.onMessage.removeListener(messageListener)
      port.onDisconnect.removeListener(disconnectListener)
      if (resp instanceof Error) throw resp
      const error = await resp.json().catch(() => ({}))
      throw new Error(!isEmpty(error) ? JSON.stringify(error) : `${resp.status} ${resp.statusText}`)
    },
  })
}

/**
 * @param {Browser.Runtime.Port} port
 * @param {string} question
 * @param {Session} session
 * @param {string} apiKey
 */
export async function generateAnswersWithChatgptApi(port, question, session, apiKey) {
  const config = await getUserConfig()
  return generateAnswersWithChatgptApiCompat(
    config.customOpenAiApiUrl + '/v1',
    port,
    question,
    session,
    apiKey,
  )
}

export async function generateAnswersWithChatgptApiCompat(
  baseUrl,
  port,
  question,
  session,
  apiKey,
  extraBody = {},
) {
  const { controller, messageListener, disconnectListener } = setAbortController(port)
  const cleanupPortListeners = () => {
    port.onMessage.removeListener(messageListener)
    port.onDisconnect.removeListener(disconnectListener)
  }
  const model = getModelValue(session)
  const isReasoningModel = isUsingReasoningModel(session)

  const config = await getUserConfig()
  const protocol = resolveOpenAiCompatibleProtocol(baseUrl, config?.agentProtocol)
  const systemPrompt = isReasoningModel
    ? ''
    : buildSystemPromptFromContext(session, config, question)
  const composedQuestion = isReasoningModel
    ? buildFallbackQuestionWithContext(question, session, config)
    : question
  const prompt = getConversationPairs(
    session.conversationRecords.slice(-config.maxConversationContextLength),
    false,
    systemPrompt ? { systemPrompt } : undefined,
  )

  // Filter messages based on model type
  // Reasoning models only support 'user' and 'assistant' roles during beta period
  const filteredPrompt = isReasoningModel
    ? prompt.filter((msg) => {
        const role = msg?.role
        return role === 'user' || role === 'assistant'
      })
    : prompt

  filteredPrompt.push({ role: 'user', content: composedQuestion })

  let answer = ''
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    pushRecord(session, question, answer)
    console.debug('conversation history', { content: session.conversationRecords })
    port.postMessage({ answer: null, done: true, session })
  }

  // Build request body with reasoning model-specific parameters
  const requestBody = {
    messages: filteredPrompt,
    model,
    ...extraBody,
  }

  // Apply model-specific configurations
  if (isReasoningModel) {
    // Reasoning models use max_completion_tokens instead of max_tokens
    requestBody.max_completion_tokens = config.maxResponseTokenLength
    // Reasoning models don't support streaming during beta
    requestBody.stream = false
    // Reasoning models have fixed parameters during beta
    requestBody.temperature = 1
    requestBody.top_p = 1
    requestBody.n = 1
    requestBody.presence_penalty = 0
    requestBody.frequency_penalty = 0
    // Remove unsupported parameters for reasoning models
    delete requestBody.tools
    delete requestBody.tool_choice
    delete requestBody.functions
    delete requestBody.function_call
    delete requestBody.max_tokens // Ensure max_tokens is not present
  } else {
    // Non-reasoning models use the existing behavior
    requestBody.stream = true
    requestBody.max_tokens = config.maxResponseTokenLength
    requestBody.temperature = config.temperature
  }

  // Validate API key with detailed error message
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error(
      'Invalid or empty API key provided. Please check your OpenAI API key configuration.',
    )
  }

  if (!isReasoningModel) {
    try {
      const toolLoop = await runMcpToolLoopForOpenAiCompat({
        protocol,
        baseUrl,
        apiKey,
        model,
        messages: filteredPrompt,
        config,
        session,
        maxResponseTokenLength: config.maxResponseTokenLength,
        temperature: config.temperature,
        extraBody,
        signal: controller.signal,
      })

      if (toolLoop) {
        appendToolEvents(session, toolLoop.events, { limit: config?.agentToolEventLimit })
        if (shouldShortCircuitWithToolLoop(toolLoop)) {
          answer = toolLoop.answer || ''
          if (answer) port.postMessage({ answer, done: false, session: null })
          finish()
          cleanupPortListeners()
          return
        }
      }
    } catch (error) {
      appendToolEvents(
        session,
        [
          {
            type: 'mcp_tool_loop',
            status: 'failed',
            reason: error?.message || String(error),
            createdAt: new Date().toISOString(),
          },
        ],
        { limit: config?.agentToolEventLimit },
      )
    }
  }

  if (!isReasoningModel && protocol === AgentProtocol.openAiResponsesV1) {
    try {
      answer = await requestWithResponsesApi({
        baseUrl,
        apiKey,
        model,
        messages: filteredPrompt,
        maxResponseTokenLength: config.maxResponseTokenLength,
        temperature: config.temperature,
        extraBody,
        signal: controller.signal,
      })
      if (answer) port.postMessage({ answer, done: false, session: null })
      finish()
      return
    } finally {
      cleanupPortListeners()
    }
  }

  await fetchSSE(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify(requestBody),
    onMessage(message) {
      console.debug('sse message', message)
      if (finished) return
      if (message.trim() === '[DONE]') {
        finish()
        return
      }
      let data
      try {
        data = JSON.parse(message)
      } catch (error) {
        console.debug('json error', error)
        return
      }

      // Validate response structure early
      const choice = data.choices?.[0]
      if (!choice) {
        console.debug('No choice in response data')
        return
      }

      if (isReasoningModel) {
        // For reasoning models (non-streaming), get the complete response
        let content = choice.message?.content ?? choice.text

        // Handle structured response arrays for reasoning models
        if (Array.isArray(content)) {
          content = extractContentFromArray(content)
        }

        // Ensure content is a string and not empty
        if (content && typeof content === 'string') {
          const trimmedContent = content.trim()
          if (trimmedContent) {
            answer = trimmedContent
            port.postMessage({ answer, done: false, session: null })
          }
        } else if (content) {
          // Handle unexpected content types gracefully
          console.debug('Unexpected content type for reasoning model:', typeof content)
          const stringContent = String(content).trim()
          if (stringContent) {
            answer = stringContent
            port.postMessage({ answer, done: false, session: null })
          }
        }

        // Only finish when we have a proper finish reason
        if (choice.finish_reason) {
          finish()
        }
      } else {
        // For non-reasoning models (streaming), handle delta content
        const delta = choice.delta?.content
        const content = choice.message?.content
        const text = choice.text
        if (delta !== undefined) {
          answer += delta
        } else if (content) {
          answer = content
        } else if (text) {
          answer += text
        }
        port.postMessage({ answer, done: false, session: null })

        if (choice.finish_reason) {
          finish()
          return
        }
      }
    },
    async onStart() {},
    async onEnd() {
      port.postMessage({ done: true })
      cleanupPortListeners()
    },
    async onError(resp) {
      cleanupPortListeners()
      if (resp instanceof Error) throw resp
      const error = await resp.json().catch(() => ({}))
      throw new Error(!isEmpty(error) ? JSON.stringify(error) : `${resp.status} ${resp.statusText}`)
    },
  })
}
