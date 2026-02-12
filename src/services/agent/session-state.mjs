export const DEFAULT_TOOL_EVENT_LIMIT = 50
export const DEFAULT_MEMORY_STEP_LIMIT = 32

function clampPositiveInt(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function normalizeStep(step) {
  if (!step || typeof step !== 'object') return null
  const type = typeof step.type === 'string' ? step.type : ''
  const detail = typeof step.detail === 'string' ? step.detail : ''
  const status = typeof step.status === 'string' ? step.status : ''
  if (!type && !detail && !status) return null
  return {
    type,
    detail,
    status,
    createdAt: typeof step.createdAt === 'string' ? step.createdAt : new Date().toISOString(),
  }
}

export function normalizeAgentMemory(memory, options = {}) {
  const stepLimit = clampPositiveInt(options.stepLimit, DEFAULT_MEMORY_STEP_LIMIT)
  if (!memory || typeof memory !== 'object') {
    return {
      objective: '',
      lastStopReason: '',
      nextAction: '',
      noProgressCount: 0,
      steps: [],
      updatedAt: new Date().toISOString(),
    }
  }

  const steps = Array.isArray(memory.steps) ? memory.steps.map(normalizeStep).filter(Boolean) : []

  return {
    objective: typeof memory.objective === 'string' ? memory.objective : '',
    lastStopReason: typeof memory.lastStopReason === 'string' ? memory.lastStopReason : '',
    nextAction: typeof memory.nextAction === 'string' ? memory.nextAction : '',
    noProgressCount: Number.isFinite(memory.noProgressCount) ? Math.max(0, memory.noProgressCount) : 0,
    steps: steps.slice(-stepLimit),
    updatedAt: typeof memory.updatedAt === 'string' ? memory.updatedAt : new Date().toISOString(),
  }
}

export function appendToolEvents(session, events, options = {}) {
  if (!session || typeof session !== 'object') return []
  if (!Array.isArray(events) || events.length === 0) return Array.isArray(session.toolEvents) ? session.toolEvents : []
  const limit = clampPositiveInt(options.limit, DEFAULT_TOOL_EVENT_LIMIT)
  const current = Array.isArray(session.toolEvents) ? session.toolEvents : []
  const next = [...current, ...events].slice(-limit)
  session.toolEvents = next
  return next
}

export function addAgentMemoryStep(session, step, options = {}) {
  if (!session || typeof session !== 'object') return null
  const normalizedStep = normalizeStep(step)
  if (!normalizedStep) return normalizeAgentMemory(session.agentMemory, options)

  const memory = normalizeAgentMemory(session.agentMemory, options)
  const stepLimit = clampPositiveInt(options.stepLimit, DEFAULT_MEMORY_STEP_LIMIT)
  memory.steps = [...memory.steps, normalizedStep].slice(-stepLimit)
  memory.updatedAt = new Date().toISOString()
  session.agentMemory = memory
  return memory
}

export function updateAgentMemory(session, patch = {}, options = {}) {
  if (!session || typeof session !== 'object') return null
  const memory = normalizeAgentMemory(session.agentMemory, options)

  if (typeof patch.objective === 'string') memory.objective = patch.objective
  if (typeof patch.lastStopReason === 'string') memory.lastStopReason = patch.lastStopReason
  if (typeof patch.nextAction === 'string') memory.nextAction = patch.nextAction
  if (Number.isFinite(patch.noProgressCount)) memory.noProgressCount = Math.max(0, patch.noProgressCount)
  if (Array.isArray(patch.steps)) {
    const normalized = patch.steps.map(normalizeStep).filter(Boolean)
    const stepLimit = clampPositiveInt(options.stepLimit, DEFAULT_MEMORY_STEP_LIMIT)
    memory.steps = normalized.slice(-stepLimit)
  }

  memory.updatedAt = new Date().toISOString()
  session.agentMemory = memory
  return memory
}
