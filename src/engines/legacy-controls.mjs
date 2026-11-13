import { EngineError, EngineOperation as Op } from './contract.mjs'
import { legacyControlForMessage } from './legacy-protocol.mjs'
import { getChatgptWebTurnStatus } from '../services/clients/chatgpt-web/turn-status.mjs'
import { recoverChatgptWebTurnStatus } from '../background/chatgpt-proxy-service.mjs'

export function createLegacyEngineControls({ service, adapters, getConfig }) {
  async function invoke(control, payload, caller, options) {
    const adapter = adapters.find((item) => item.describe().id === control.engineId)
    const converted = adapter.fromLegacyControl(payload, await getConfig())
    const request = converted.request
    if (control.mode === 'append') {
      if (!payload.conversationId)
        throw new EngineError('INVALID_REQUEST', 'conversationId is required.')
      const candidates = await service.privateBindings(control.engineId, caller)
      let binding = candidates.find(
        (item) => item.nativeRef.session?.conversationId === payload.conversationId,
      )
      if (!binding) {
        const detail = await service.history(
          control.engineId,
          Op.ReadConversation,
          { conversationId: payload.conversationId, forceRefresh: true, latestOnly: true },
          caller,
        )
        const reference = adapter.referenceFromHistory(detail, payload.model || payload.modelSlug)
        const imported = await service.importBinding(control.engineId, reference, caller)
        binding = await service.binding(imported.ref)
      }
      if (payload.previousResponseID && binding.nativeRef.head !== payload.previousResponseID)
        throw new EngineError(
          'BINDING_CHANGED',
          'The explicit Grok response ID no longer matches the verified native head.',
        )
      if (!payload.model && !payload.modelSlug && binding.modelId) request.modelId = binding.modelId
      request.operation = Op.Append
      request.conversation = { ref: binding.ref, expectedRevision: binding.revision }
    }
    const receipt = await service.invoke(request, caller, {
      ...options,
      runId: options.runId || payload.operationId,
      legacySession: converted.session,
    })
    const accepted = await service.wait(receipt.runId, caller, {
      accepted: control.engineId === 'chatgptweb',
      timeoutMs: 60000,
    })
    if (accepted.submission === 'not_attempted')
      return {
        dispatched: false,
        error: accepted.error?.message || 'The provider did not accept this request.',
        code: accepted.error?.code,
      }
    const record = await service.privateRecord(receipt.runId, caller)
    const native = record.nativeRef?.session
    if (!native?.conversationId || !native.messageId)
      throw new EngineError(
        'RESULT_UNCERTAIN',
        'The provider returned no correlated conversation acknowledgement.',
        { runId: receipt.runId, submission: accepted.submission },
      )
    if (control.engineId !== 'chatgptweb' && accepted.outcome !== 'completed')
      throw new EngineError(
        'RESULT_UNCERTAIN',
        accepted.error?.message || 'The native response did not complete.',
        { runId: receipt.runId, submission: accepted.submission },
      )
    return {
      conversationId: native.conversationId,
      messageId: native.messageId,
      runId: receipt.runId,
      conversationRef: accepted.conversationRef,
      query: request.input.prompt,
      defaultModel: record.modelId,
      projectId: native.chatgptWebProjectId || null,
      attachments: converted.session.chatgptWebImagePointers || [],
      pending: accepted.phase !== 'settled',
      createdAt: new Date(record.createdAt).toISOString(),
      ...(native.previousResponseID ? { previousResponseID: native.previousResponseID } : {}),
      ...(accepted.result
        ? { answer: accepted.result.content, text: accepted.result.content }
        : {}),
    }
  }

  async function turn(payload, caller) {
    let record
    try {
      record = await service.privateRecord(payload.messageId, caller)
    } catch (error) {
      if (error.code !== 'RESULT_UNAVAILABLE') throw error
      // Pre-migration records retain their old read owner. They are available
      // only to the API/extension identities which already had this interface.
      if (caller.kind === 'mcp') throw error
      return payload.recover === true
        ? recoverChatgptWebTurnStatus(payload)
        : getChatgptWebTurnStatus(payload)
    }
    if (record.nativeRef?.session?.conversationId !== payload.conversationId) return null
    const value =
      payload.recover === true
        ? await service.recover(record.runId, caller)
        : await service.read(record.runId, caller)
    return {
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      runId: record.runId,
      status:
        value.outcome === 'completed' && value.result
          ? 'completed'
          : ['failed', 'stopped', 'incomplete'].includes(value.outcome)
          ? 'failed'
          : 'running',
      outcome: value.outcome,
      text: value.result?.content || value.preview?.content || '',
      error: value.error?.message || null,
      updatedAt: new Date(value.updatedAt).toISOString(),
      ...(value.outcome === 'unknown' ? { executionUnknown: true } : {}),
    }
  }

  return async (message, caller, options = {}) => {
    const control = legacyControlForMessage(message.type)
    if (!control)
      throw new EngineError('OPERATION_NOT_IMPLEMENTED', 'Unknown legacy engine interface.')
    const payload = message.data || {}
    if (control.mode === 'create' || control.mode === 'append')
      return invoke(control, payload, caller, options)
    if (control.mode === 'turn') return turn(payload, caller)
    if (control.mode === 'models') {
      const catalog = await service.models(control.engineId, caller, {
        refresh: control.engineId === 'chatgptweb',
      })
      return catalog.items.map((model) => model.id)
    }
    if (control.mode === 'extension') {
      const { operationId, ...query } = payload
      return service.extension(control.engineId, control.operation, query, caller, {
        ...options,
        runId: options.runId || operationId,
      })
    }
    return service.history(
      control.engineId,
      control.operation,
      { ...payload, ...(control.mode === 'refresh' ? { forceRefresh: true } : {}) },
      caller,
    )
  }
}
