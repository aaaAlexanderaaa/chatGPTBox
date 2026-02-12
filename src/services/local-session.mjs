import Browser from 'webextension-polyfill'
import { initSession } from './init-session.mjs'
import { getUserConfig } from '../config/index.mjs'
import { DEFAULT_TOOL_EVENT_LIMIT, normalizeAgentMemory } from './agent/session-state.mjs'

export const initDefaultSession = async () => {
  const config = await getUserConfig()
  return initSession({
    sessionName: new Date().toLocaleString(),
    modelName: config.modelName,
    apiMode: config.apiMode,
    autoClean: false,
    extraCustomModelName: config.customModelName,
    assistantId: null,
    selectedSkillIds: null,
    selectedMcpServerIds: null,
  })
}

export const createSession = async (newSession) => {
  let currentSessions
  if (newSession) {
    const ret = await getSession(newSession.sessionId)
    currentSessions = ret.currentSessions
    if (ret.session)
      currentSessions[
        currentSessions.findIndex((session) => session.sessionId === newSession.sessionId)
      ] = newSession
    else currentSessions.unshift(newSession)
  } else {
    newSession = await initDefaultSession()
    currentSessions = await getSessions()
    currentSessions.unshift(newSession)
  }
  await Browser.storage.local.set({ sessions: currentSessions })
  return { session: newSession, currentSessions }
}

export const deleteSession = async (sessionId) => {
  const currentSessions = await getSessions()
  const index = currentSessions.findIndex((session) => session.sessionId === sessionId)
  if (index === -1) return currentSessions
  currentSessions.splice(index, 1)
  if (currentSessions.length > 0) {
    await Browser.storage.local.set({ sessions: currentSessions })
    return currentSessions
  }
  return await resetSessions()
}

export const getSession = async (sessionId) => {
  const currentSessions = await getSessions()
  return {
    session: currentSessions.find((session) => session.sessionId === sessionId),
    currentSessions,
  }
}

export const updateSession = async (newSession) => {
  const currentSessions = await getSessions()
  const index = currentSessions.findIndex((session) => session.sessionId === newSession.sessionId)
  if (index === -1) return currentSessions
  newSession.updatedAt = new Date().toISOString()
  currentSessions[index] = newSession
  await Browser.storage.local.set({ sessions: currentSessions })
  return currentSessions
}

export const resetSessions = async () => {
  const currentSessions = [await initDefaultSession()]
  await Browser.storage.local.set({ sessions: currentSessions })
  return currentSessions
}

export const getSessions = async () => {
  const { sessions } = await Browser.storage.local.get('sessions')
  if (sessions && sessions.length > 0) {
    const config = await getUserConfig()
    const toolEventLimit = Number.isFinite(config?.agentToolEventLimit)
      ? Math.max(1, Math.floor(config.agentToolEventLimit))
      : DEFAULT_TOOL_EVENT_LIMIT
    let needsFix = false
    const fixedSessions = sessions.map((session) => {
      if (!session || typeof session !== 'object') {
        needsFix = true
        return session
      }
      const fixed = { ...session }
      const fixedAssistantId = typeof session.assistantId === 'string' ? session.assistantId : null
      if (fixedAssistantId !== session.assistantId) {
        fixed.assistantId = fixedAssistantId
        needsFix = true
      }

      const fixedSystemPrompt =
        typeof session.systemPromptOverride === 'string' ? session.systemPromptOverride : ''
      if (fixedSystemPrompt !== session.systemPromptOverride) {
        fixed.systemPromptOverride = fixedSystemPrompt
        needsFix = true
      }

      const fixedSkillIds = Array.isArray(session.selectedSkillIds) ? session.selectedSkillIds : null
      if (fixedSkillIds !== session.selectedSkillIds) {
        fixed.selectedSkillIds = fixedSkillIds
        needsFix = true
      }

      const fixedServerIds = Array.isArray(session.selectedMcpServerIds)
        ? session.selectedMcpServerIds
        : null
      if (fixedServerIds !== session.selectedMcpServerIds) {
        fixed.selectedMcpServerIds = fixedServerIds
        needsFix = true
      }

      const fixedPageContext =
        session.pageContext && typeof session.pageContext === 'object' ? session.pageContext : null
      if (fixedPageContext !== session.pageContext) {
        fixed.pageContext = fixedPageContext
        needsFix = true
      }

      const fixedToolEvents = Array.isArray(session.toolEvents)
        ? session.toolEvents.slice(-toolEventLimit)
        : []
      if (
        !Array.isArray(session.toolEvents) ||
        fixedToolEvents.length !== session.toolEvents.length
      ) {
        fixed.toolEvents = fixedToolEvents
        needsFix = true
      }

      const normalizedMemory = normalizeAgentMemory(session.agentMemory)
      if (
        !session.agentMemory ||
        typeof session.agentMemory !== 'object' ||
        !Array.isArray(session.agentMemory.steps) ||
        session.agentMemory.steps.length !== normalizedMemory.steps.length ||
        session.agentMemory.objective !== normalizedMemory.objective ||
        session.agentMemory.lastStopReason !== normalizedMemory.lastStopReason ||
        session.agentMemory.nextAction !== normalizedMemory.nextAction ||
        session.agentMemory.noProgressCount !== normalizedMemory.noProgressCount
      ) {
        fixed.agentMemory = normalizedMemory
        needsFix = true
      }

      return fixed
    })
    if (needsFix) {
      await Browser.storage.local.set({ sessions: fixedSessions })
    }
    return fixedSessions
  }
  return await resetSessions()
}
