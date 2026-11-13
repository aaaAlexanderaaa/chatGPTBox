import { EngineError, EngineOperation as Op, compilePromptTranscript } from './contract.mjs'

function legacyTranscript(messages) {
  if (!Array.isArray(messages) || !messages.length)
    throw new EngineError('INVALID_REQUEST', 'messages are required.')
  if (messages.length === 1) return messages[0].content
  return messages
    .map(
      (msg) =>
        `${msg.role === 'system' ? 'System' : msg.role === 'assistant' ? 'Assistant' : 'User'}: ${
          msg.content
        }`,
    )
    .join('\n\n')
}

// This projection is the only owner of the old implicit transcript continuation.
// The executor always receives an explicitly named generation or append operation.
export function createCompletionCompatibility({ service, adapters, getConfig }) {
  return async (payload, caller, options = {}) => {
    const adapter =
      adapters.find((item) => {
        const definition = item.describe()
        return (
          payload.model?.startsWith(`${definition.id}/`) ||
          definition.legacyModelPrefixes?.some((prefix) => payload.model?.startsWith(prefix))
        )
      }) || adapters.find((item) => item.describe().legacyDefault)
    if (!adapter)
      throw new EngineError('ENGINE_NOT_FOUND', 'No engine matches this compatibility model.')
    const config = await getConfig()
    const prompt =
      payload.contractVersion === 1
        ? compilePromptTranscript(payload.messages).prompt
        : legacyTranscript(payload.messages)
    if (typeof prompt !== 'string' || !prompt.trim())
      throw new EngineError('INPUT_UNSUPPORTED', 'A nonempty text transcript is required.')
    const converted = adapter.fromLegacyControl(
      {
        query: prompt,
        model: payload.model,
        thinkingEffort: payload.thinkingEffort,
        projectId: payload.projectId,
      },
      config,
    )
    if (payload.images?.length) converted.request.input.attachments = payload.images
    adapter.configureCompletion?.(converted, config)
    const continuation =
      payload.contractVersion === 1 ? null : await adapter.findLegacyContinuation?.(payload)
    if (continuation) {
      const candidates = await service.privateBindings(converted.request.engineId, caller)
      const existing = candidates.find(
        (binding) => binding.nativeRef.session?.conversationId === continuation.conversationId,
      )
      converted.request.operation = Op.Append
      converted.request.input.prompt = continuation.nextUserMessage.content
      converted.request.conversation = existing
        ? { ref: existing.ref, expectedRevision: existing.revision }
        : await service.importBinding(
            converted.request.engineId,
            adapter.referenceForContinuation(continuation, converted.request.modelId),
            caller,
          )
    }
    const receipt = await service.invoke(converted.request, caller, {
      ...options,
      legacySession: converted.session,
    })
    const finish = async () => {
      const final = await service.wait(receipt.runId, caller)
      if (final.outcome !== 'completed' || !final.result)
        throw new EngineError(
          final.error?.code || 'RESULT_UNCERTAIN',
          final.error?.message || 'The engine returned no verified final result.',
          { ...final.error, runId: receipt.runId, submission: final.submission },
        )
      if (payload.contractVersion !== 1) {
        const record = await service.privateRecord(receipt.runId, caller)
        await adapter.rememberLegacyCompletion?.(
          payload,
          final.result.content,
          record.nativeRef?.session,
        )
      }
      return {
        answer: final.result.content,
        format: final.result.format,
        runId: receipt.runId,
        projection: payload.contractVersion === 1 ? 'prompt-transcript-v1' : 'legacy',
      }
    }
    if (options.wait === false) {
      void finish().catch(() => {})
      return receipt
    }
    return finish()
  }
}
