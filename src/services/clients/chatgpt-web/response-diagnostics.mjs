// Record server-reported facts, without retaining thought text or credentials.
// No observed reasoning event does not prove that the model did not reason.
export function createChatgptWebResponseDiagnostics() {
  const models = new Set()
  const resolvedModels = new Set()
  const efforts = new Set()
  const durations = new Map()
  let reasoningObserved = false

  function addString(set, value) {
    if (typeof value === 'string' && value.trim()) set.add(value.trim())
  }

  return {
    observe(data) {
      const message = data?.message
      const metadata =
        message?.author?.role === 'assistant'
          ? message.metadata
          : data?.type === 'server_ste_metadata'
          ? data.metadata
          : null
      addString(models, metadata?.model_slug)
      addString(resolvedModels, metadata?.resolved_model_slug)
      addString(efforts, metadata?.thinking_effort)
      if (message?.author?.role !== 'assistant') return
      const contentType = message.content?.content_type
      if (
        contentType === 'thoughts' ||
        contentType === 'reasoning_recap' ||
        metadata?.reasoning_status === 'is_reasoning' ||
        metadata?.reasoning_status === 'reasoning_ended'
      ) {
        reasoningObserved = true
      }
      const duration = metadata?.finished_duration_sec
      if (message.id && Number.isFinite(duration) && duration >= 0) {
        durations.set(message.id, duration)
      }
    },
    snapshot() {
      return {
        reportedModels: [...models],
        resolvedModels: [...resolvedModels],
        reportedThinkingEfforts: [...efforts],
        reasoningObserved,
        reasoningDurationSeconds: durations.size
          ? [...durations.values()].reduce((sum, duration) => sum + duration, 0)
          : null,
      }
    },
  }
}
