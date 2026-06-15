import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import Browser from 'webextension-polyfill'
import InputBox from '../InputBox'
import ConversationItem from '../ConversationItem'
import {
  apiModeToModelName,
  buildPageContextSnapshot,
  createElementAtPosition,
  extractTemplateVariables,
  getApiModesFromConfig,
  isApiModeSelected,
  isFirefox,
  isMobile,
  isSafari,
  isUsingModelName,
  modelNameToDesc,
} from '../../utils'
import {
  X,
  Pin,
  ExternalLink,
  PanelRight,
  Archive,
  ArrowDown,
  Check,
  ChevronDown,
  Download,
  Search,
} from 'lucide-react'
import FileSaver from 'file-saver'
import { render } from 'preact'
import FloatingToolbar from '../FloatingToolbar'
import { useClampWindowSize } from '../../hooks/use-clamp-window-size'
import { getUserConfig } from '../../config/storage.mjs'
import { isModelDeprecated } from '../../config/models.mjs'
import { isUsingBingWebModel } from '../../config/predicates.mjs'
import { useTranslation } from 'react-i18next'
import DeleteButton from '../DeleteButton'
import { useConfig } from '../../hooks/use-config.mjs'
import { useConversationRuntime } from '../../hooks/useConversationRuntime.mjs'
import { createSession } from '../../services/local-session.mjs'
import { v4 as uuidv4 } from 'uuid'
import { initSession } from '../../services/init-session.mjs'
import { generateAnswersWithBingWebApi } from '../../services/apis/bing-web.mjs'
import {
  deleteChatgptWebSessionSnapshot,
  restoreChatgptWebSessionSnapshot,
  saveChatgptWebSessionSnapshot,
} from '../../services/clients/chatgpt-web/thread-state.mjs'
import { handlePortError } from '../../services/wrappers.mjs'
import {
  getAssistants,
  isAgentContextAllowedForSession,
  getMcpServers,
  getSkills,
  resolveAssistant,
  resolveSelectedMcpServerIds,
  resolveSelectedSkillIds,
} from '../../services/agent-context.mjs'
import { RuntimeMessage } from '../../protocol/messages.mjs'

/* global __CHATGPTBOX_ENABLE_AGENTS__ */
const ENABLE_AGENT_FEATURES =
  typeof __CHATGPTBOX_ENABLE_AGENTS__ !== 'undefined' && __CHATGPTBOX_ENABLE_AGENTS__ === true

const logo = Browser.runtime.getURL('logo.png')

// ConversationItemData now lives in ./conversation-item.mjs and is shared with
// the useConversationRuntime hook.
import { ConversationItemData } from './conversation-item.mjs'

function ConversationCard(props) {
  const { t } = useTranslation()
  const [port, setPort] = useState(() => Browser.runtime.connect())
  const [triggered, setTriggered] = useState(!props.waitForTrigger)
  // Conversation state machine lives in the runtime hook so it can be unit-
  // tested without a browser. We alias its pieces to the local names the rest
  // of this component already uses, to keep the diff mechanical.
  const { state: runtimeState, actions: runtimeActions } = useConversationRuntime({
    initialSession: props.session,
    t,
    hasInitialQuestion: !!props.question,
  })
  const session = runtimeState.session
  const isReady = runtimeState.isReady
  const setSession = runtimeActions.setSession
  const setIsReady = runtimeActions.setIsReady
  // conversationItemData <-> runtime items (aliased to minimize churn below).
  const conversationItemData = runtimeState.items
  const setConversationItemData = runtimeActions.setItems
  const updateAnswer = runtimeActions.updateAnswer
  const dispatchInbound = runtimeActions.dispatchInbound
  const buildRetry = runtimeActions.buildRetry
  const windowSize = useClampWindowSize([750, 1500], [250, 1100])
  const bodyRef = useRef(null)
  const [completeDraggable, setCompleteDraggable] = useState(false)
  const useForegroundFetch = isUsingBingWebModel(session)
  const [apiModes, setApiModes] = useState([])
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [modelPickerQuery, setModelPickerQuery] = useState('')
  const modelPickerRef = useRef(null)
  const modelPickerInputRef = useRef(null)
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
  const agentPickerRef = useRef(null)

  const config = useConfig()

  useLayoutEffect(() => {
    if (session.conversationRecords.length === 0) {
      if (props.question && triggered)
        setConversationItemData([
          new ConversationItemData(
            'answer',
            `<p class="gpt-loading">${t(`Waiting for response...`)}</p>`,
          ),
        ])
    } else {
      const ret = []
      for (const record of session.conversationRecords) {
        ret.push(new ConversationItemData('question', record.question, true))
        ret.push(new ConversationItemData('answer', record.answer, true))
      }
      setConversationItemData(ret)
    }
  }, [])

  useEffect(() => {
    setCompleteDraggable(!isSafari() && !isFirefox() && !isMobile())
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!session?.sessionId) return () => {}
    if (session.conversationId || session.parentMessageId || session.wsRequestId) return () => {}

    void restoreChatgptWebSessionSnapshot(session)
      .then((restoredSession) => {
        if (cancelled || !restoredSession || restoredSession === session) return
        if (
          restoredSession.conversationId === session.conversationId &&
          restoredSession.parentMessageId === session.parentMessageId &&
          restoredSession.messageId === session.messageId &&
          restoredSession.wsRequestId === session.wsRequestId
        ) {
          return
        }

        setSession((prev) => {
          if (!prev || prev.sessionId !== restoredSession.sessionId) return prev
          return { ...prev, ...restoredSession }
        })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [session?.sessionId])

  useEffect(() => {
    if (!session?.sessionId) return
    if (!session.conversationId && !session.parentMessageId && !session.wsRequestId) return
    void saveChatgptWebSessionSnapshot(session, {
      source: props.pageMode
        ? 'independent-panel'
        : props.draggable
        ? 'floating-toolbar'
        : 'conversation-card',
    }).catch(() => {})
  }, [
    props.draggable,
    props.pageMode,
    session?.sessionId,
    session?.conversationId,
    session?.parentMessageId,
    session?.messageId,
    session?.wsRequestId,
    session?.modelName,
    session?.question,
  ])

  useEffect(() => {
    if (props.onUpdate) props.onUpdate(port, session, conversationItemData)
  }, [session, conversationItemData])

  useEffect(() => {
    const { offsetHeight, scrollHeight, scrollTop } = bodyRef.current
    if (
      config.lockWhenAnswer &&
      scrollHeight <= scrollTop + offsetHeight + config.answerScrollMargin
    ) {
      bodyRef.current.scrollTo({
        top: scrollHeight,
        behavior: 'instant',
      })
    }
  }, [conversationItemData])

  useEffect(() => {
    // Restore any saved ChatGPT Web state before the first request so a remount
    // continues the same conversation instead of silently starting over.
    if (!props.question || !triggered) return

    let cancelled = false
    ;(async () => {
      const [runtimeConfig, restoredSession] = await Promise.all([
        getUserConfig(),
        restoreChatgptWebSessionSnapshot(session).catch(() => session),
      ])
      if (cancelled) return
      const newSession = withCurrentPageContext(
        {
          ...(restoredSession && typeof restoredSession === 'object' ? restoredSession : session),
          question: props.question,
          updatedAt: new Date().toISOString(),
        },
        runtimeConfig,
      )
      setSession(newSession)
      await postMessage({ session: newSession })
    })()

    return () => {
      cancelled = true
    }
  }, [props.question, triggered]) // usually only triggered once

  useLayoutEffect(() => {
    setApiModes(
      getApiModesFromConfig(config, true).filter((apiMode) => {
        if (!apiMode || !apiMode.groupName) return false
        const modelName = apiModeToModelName(apiMode)
        const isSelected = isApiModeSelected(apiMode, session)
        const providerEnabled = config.enabledProviders?.[apiMode.groupName] === true
        if (!providerEnabled && !isSelected) return false
        if (!config.showDeprecatedModels && !isSelected && isModelDeprecated(modelName))
          return false
        return true
      }),
    )
  }, [
    config.activeApiModes,
    config.customApiModes,
    config.azureDeploymentName,
    config.ollamaModelName,
    config.enabledProviders,
    config.showDeprecatedModels,
    session.apiMode,
    session.modelName,
  ])

  useEffect(() => {
    if (!modelPickerOpen) return
    const handleClickOutside = (event) => {
      if (!modelPickerRef.current) return
      if (!modelPickerRef.current.contains(event.target)) {
        setModelPickerOpen(false)
        setModelPickerQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [modelPickerOpen])

  useEffect(() => {
    if (!modelPickerOpen) return
    const id = setTimeout(() => modelPickerInputRef.current?.focus(), 0)
    return () => clearTimeout(id)
  }, [modelPickerOpen])

  useEffect(() => {
    if (!agentPickerOpen) return
    const handleClickOutside = (event) => {
      if (!agentPickerRef.current) return
      if (!agentPickerRef.current.contains(event.target)) {
        setAgentPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [agentPickerOpen])

  useEffect(() => {
    // One-time migration: ensure agent-context fields exist on legacy sessions
    setSession((prev) => {
      if (!prev || typeof prev !== 'object') return prev
      const patch = {}
      if (!('selectedSkillIds' in prev)) patch.selectedSkillIds = null
      if (!('selectedMcpServerIds' in prev)) patch.selectedMcpServerIds = null
      if (typeof prev.systemPromptOverride !== 'string') patch.systemPromptOverride = ''
      if (!('assistantId' in prev)) patch.assistantId = null
      if (!('pageContext' in prev) || (prev.pageContext && typeof prev.pageContext !== 'object'))
        patch.pageContext = null
      if (!('toolEvents' in prev) || !Array.isArray(prev.toolEvents)) patch.toolEvents = []
      if (!('agentMemory' in prev) || (prev.agentMemory && typeof prev.agentMemory !== 'object'))
        patch.agentMemory = null
      if (Object.keys(patch).length === 0) return prev
      return { ...prev, ...patch }
    })
  }, [])

  /**
   * @param {string} value
   * @param {boolean} appended
   * @param {'question'|'answer'|'error'} newType
   * @param {boolean} done
   */
  // updateAnswer + portMessageListener (now dispatchInbound) moved into
  // useConversationRuntime. The inbound-message reducer is transport-agnostic;
  // the port subscription effect below wires it to port.onMessage.

  const foregroundMessageListeners = useRef([])

  /**
   * @param {Session|undefined} session
   * @param {boolean|undefined} stop
   */
  const postMessage = async ({ session, stop }) => {
    if (useForegroundFetch) {
      foregroundMessageListeners.current.forEach((listener) => listener({ session, stop }))
      if (session) {
        const fakePort = {
          postMessage: (msg) => {
            dispatchInbound(msg)
          },
          onMessage: {
            addListener: (listener) => {
              foregroundMessageListeners.current.push(listener)
            },
            removeListener: (listener) => {
              foregroundMessageListeners.current.splice(
                foregroundMessageListeners.current.indexOf(listener),
                1,
              )
            },
          },
          onDisconnect: {
            addListener: () => {},
            removeListener: () => {},
          },
        }
        try {
          const bingToken = (await getUserConfig()).bingAccessToken
          if (isUsingModelName('bingFreeSydney', session))
            await generateAnswersWithBingWebApi(
              fakePort,
              session.question,
              session,
              bingToken,
              true,
            )
          else await generateAnswersWithBingWebApi(fakePort, session.question, session, bingToken)
        } catch (err) {
          handlePortError(session, fakePort, err)
        }
      }
    } else {
      port.postMessage({ session, stop })
    }
  }

  useEffect(() => {
    const portListener = () => {
      setPort(Browser.runtime.connect())
      setIsReady(true)
    }

    const closeChatsMessageListener = (message) => {
      if (message.type === RuntimeMessage.CloseChats) {
        port.disconnect()
        Browser.runtime.onMessage.removeListener(closeChatsMessageListener)
        window.removeEventListener('keydown', closeChatsEscListener)
        if (props.onClose) props.onClose()
      }
    }
    const closeChatsEscListener = async (e) => {
      if (e.key === 'Escape' && (await getUserConfig()).allowEscToCloseAll) {
        closeChatsMessageListener({ type: RuntimeMessage.CloseChats })
      }
    }

    if (props.closeable) {
      Browser.runtime.onMessage.addListener(closeChatsMessageListener)
      window.addEventListener('keydown', closeChatsEscListener)
    }
    port.onDisconnect.addListener(portListener)
    return () => {
      if (props.closeable) {
        Browser.runtime.onMessage.removeListener(closeChatsMessageListener)
        window.removeEventListener('keydown', closeChatsEscListener)
      }
      port.onDisconnect.removeListener(portListener)
    }
  }, [port])
  useEffect(() => {
    if (useForegroundFetch) return () => {}
    port.onMessage.addListener(dispatchInbound)
    return () => {
      port.onMessage.removeListener(dispatchInbound)
    }
  }, [port, useForegroundFetch, dispatchInbound])

  // Retry state machine lives in useConversationRuntime.buildRetry; it needs the
  // transport `postMessage` to (re)send, which we inject here so the runtime
  // stays transport-agnostic and unit-testable.
  const getRetryFn = (session) => buildRetry(session, postMessage)

  const retryFn = useMemo(() => getRetryFn(session), [session])

  const modelPickerOptions = useMemo(() => {
    const opts = apiModes
      .map((apiMode, index) => {
        const modelName = apiModeToModelName(apiMode)
        const displayName = apiMode.displayName?.trim()
        const label = displayName
          ? displayName
          : modelNameToDesc(modelName, t, config.customModelName)
        return label ? { id: `mode-${index}`, modelName, apiMode, label } : null
      })
      .filter(Boolean)

    opts.push({
      id: 'customModel',
      modelName: 'customModel',
      apiMode: null,
      label: modelNameToDesc('customModel', t, config.customModelName),
    })

    const currentModelName = session.apiMode
      ? apiModeToModelName(session.apiMode)
      : session.modelName
    const hasCurrentSelection = session.apiMode
      ? opts.some((o) => o.apiMode && isApiModeSelected(o.apiMode, session))
      : opts.some((o) => o.modelName === session.modelName)
    if (currentModelName && !hasCurrentSelection) {
      const displayName = session.apiMode?.displayName?.trim()
      opts.unshift({
        id: 'session-current',
        modelName: currentModelName,
        apiMode: session.apiMode || null,
        label: displayName
          ? displayName
          : modelNameToDesc(currentModelName, t, config.customModelName),
      })
    }

    return opts
  }, [apiModes, config.customModelName, session.apiMode, session.modelName, t])

  const filteredModelPickerOptions = useMemo(() => {
    const q = modelPickerQuery.trim().toLowerCase()
    if (!q) return modelPickerOptions
    return modelPickerOptions.filter((opt) => {
      const label = (opt.label || '').toLowerCase()
      const modelName = (opt.modelName || '').toLowerCase()
      return label.includes(q) || modelName.includes(q)
    })
  }, [modelPickerOptions, modelPickerQuery])

  const assistants = useMemo(
    () => getAssistants(config).filter((assistant) => assistant.active !== false),
    [config.assistants],
  )
  const skills = useMemo(
    () => getSkills(config).filter((skill) => skill.active !== false),
    [config.installedSkills],
  )
  const mcpServers = useMemo(
    () => getMcpServers(config).filter((server) => server.active !== false),
    [config.mcpServers],
  )
  const resolvedAssistant = useMemo(
    () => resolveAssistant(session, config),
    [config.assistants, config.defaultAssistantId, session.assistantId],
  )
  const selectedSkillIds = useMemo(
    () => resolveSelectedSkillIds(session, config, resolvedAssistant),
    [config.defaultSkillIds, resolvedAssistant, session.selectedSkillIds],
  )
  const selectedMcpServerIds = useMemo(
    () => resolveSelectedMcpServerIds(session, config, resolvedAssistant),
    [config.defaultMcpServerIds, resolvedAssistant, session.selectedMcpServerIds],
  )
  const assistantSelectValue = useMemo(() => {
    if (typeof session.assistantId === 'string') return session.assistantId
    return resolvedAssistant?.id || ''
  }, [resolvedAssistant, session.assistantId])
  const recentToolEvents = useMemo(() => {
    const events = Array.isArray(session.toolEvents) ? session.toolEvents : []
    return events.slice(-5).reverse()
  }, [session.toolEvents])
  const agentContextEnabled = useMemo(
    () => isAgentContextAllowedForSession(session),
    [session.apiMode, session.modelName],
  )
  const withCurrentPageContext = useCallback(
    (baseSession, runtimeConfig = config) => {
      if (!isAgentContextAllowedForSession(baseSession)) {
        return {
          ...baseSession,
          pageContext: null,
        }
      }
      const effectiveAssistant = resolveAssistant(baseSession, runtimeConfig)
      const effectiveSelectedSkillIds = resolveSelectedSkillIds(
        baseSession,
        runtimeConfig,
        effectiveAssistant,
      )
      const effectiveSelectedMcpServerIds = resolveSelectedMcpServerIds(
        baseSession,
        runtimeConfig,
        effectiveAssistant,
      )

      const shouldAttachPageContext =
        (typeof baseSession.systemPromptOverride === 'string' &&
          baseSession.systemPromptOverride.trim()) ||
        Boolean(effectiveAssistant) ||
        effectiveSelectedSkillIds.length > 0 ||
        effectiveSelectedMcpServerIds.length > 0

      if (!shouldAttachPageContext) return { ...baseSession, pageContext: null }

      let shouldCaptureFullHtmlContext = false
      if (ENABLE_AGENT_FEATURES && runtimeConfig.runtimeMode === 'developer') {
        const templates = []
        if (
          typeof baseSession.systemPromptOverride === 'string' &&
          baseSession.systemPromptOverride.trim()
        ) {
          templates.push(baseSession.systemPromptOverride)
        }
        if (effectiveAssistant?.systemPrompt) templates.push(effectiveAssistant.systemPrompt)

        const selected = new Set(effectiveSelectedSkillIds)
        const effectiveSkills = getSkills(runtimeConfig).filter(
          (skill) => skill.active !== false && selected.has(skill.id),
        )
        for (const skill of effectiveSkills) {
          if (typeof skill.instructions === 'string' && skill.instructions.trim()) {
            templates.push(skill.instructions)
          }
        }

        shouldCaptureFullHtmlContext = templates.some((template) => {
          const variables = extractTemplateVariables(template)
          return variables.includes('fullhtml') || variables.includes('bodyhtml')
        })
      }

      try {
        const snapshot = buildPageContextSnapshot(runtimeConfig.customContentExtractors, {
          includeFullHtml: shouldCaptureFullHtmlContext,
        })
        if (snapshot) return { ...baseSession, pageContext: snapshot }
      } catch (error) {
        console.debug('Failed to capture page context snapshot:', error)
      }
      return { ...baseSession, pageContext: null }
    },
    [config],
  )

  const toggleSelectedId = useCallback((currentIds, targetId) => {
    if (currentIds.includes(targetId)) return currentIds.filter((id) => id !== targetId)
    return [...currentIds, targetId]
  }, [])

  const applyModelSelection = useCallback(
    ({ apiMode, modelName }) => {
      const newSession = {
        ...session,
        modelName,
        apiMode,
        aiName: apiMode?.displayName?.trim()
          ? apiMode.displayName.trim()
          : modelNameToDesc(
              apiMode ? apiModeToModelName(apiMode) : modelName,
              t,
              config.customModelName,
            ),
      }
      setModelPickerOpen(false)
      setModelPickerQuery('')
      if (config.autoRegenAfterSwitchModel && conversationItemData.length > 0)
        getRetryFn(newSession)()
      else setSession(newSession)
    },
    [
      config.autoRegenAfterSwitchModel,
      config.customModelName,
      conversationItemData.length,
      session,
      t,
    ],
  )

  return (
    <div className="gpt-inner">
      <div
        className={
          props.draggable ? `gpt-header${completeDraggable ? ' draggable' : ''}` : 'gpt-header'
        }
        style="user-select:none;"
      >
        <span
          className="gpt-util-group"
          style={{
            padding: '15px 0 15px 15px',
            ...(props.notClampSize ? {} : { flexGrow: isSafari() ? 0 : 1 }),
            ...(isSafari() ? { maxWidth: '200px' } : {}),
          }}
        >
          {props.closeable ? (
            <span
              className="gpt-util-icon"
              title={t('Close the Window')}
              onClick={() => {
                port.disconnect()
                if (props.onClose) props.onClose()
              }}
            >
              <X size={16} />
            </span>
          ) : props.dockable ? (
            <span
              className="gpt-util-icon"
              title={t('Pin the Window')}
              onClick={() => {
                if (props.onDock) props.onDock()
              }}
            >
              <Pin size={16} />
            </span>
          ) : (
            <img src={logo} style="user-select:none;width:20px;height:20px;" />
          )}
          <div
            ref={modelPickerRef}
            style={{
              position: 'relative',
              ...(props.notClampSize ? {} : { width: 0, flexGrow: 1 }),
            }}
          >
            <button
              type="button"
              className="normal-button"
              style={{ width: '100%', justifyContent: 'space-between' }}
              onClick={() => setModelPickerOpen((v) => !v)}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {session.apiMode?.displayName?.trim()
                  ? session.apiMode.displayName.trim()
                  : modelNameToDesc(
                      session.apiMode ? apiModeToModelName(session.apiMode) : session.modelName,
                      t,
                      config.customModelName,
                    )}
              </span>
              <ChevronDown size={16} style={{ flexShrink: 0, opacity: 0.8 }} />
            </button>

            {modelPickerOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: '6px',
                  zIndex: 1000,
                  minWidth: '260px',
                  maxWidth: '420px',
                  background: 'var(--popover)',
                  border: '1px solid var(--border)',
                  borderRadius: '0.75rem',
                  overflow: 'hidden',
                  boxShadow: 'var(--shadow-lg)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--card)',
                  }}
                >
                  <Search size={16} style={{ opacity: 0.8 }} />
                  <input
                    ref={modelPickerInputRef}
                    value={modelPickerQuery}
                    onChange={(e) => setModelPickerQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        setModelPickerOpen(false)
                        setModelPickerQuery('')
                      }
                    }}
                    placeholder={t('Search')}
                    style={{
                      width: '100%',
                      height: '32px',
                      border: '1px solid var(--border)',
                      background: 'var(--input)',
                      color: 'var(--foreground)',
                      borderRadius: '0.5rem',
                      padding: '0 10px',
                      fontSize: '13px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{ maxHeight: '300px', overflow: 'auto' }}>
                  {filteredModelPickerOptions.length === 0 ? (
                    <div
                      style={{
                        padding: '10px',
                        fontSize: '12px',
                        color: 'var(--muted-foreground)',
                      }}
                    >
                      {t('No results')}
                    </div>
                  ) : (
                    filteredModelPickerOptions.map((opt) => {
                      const selected =
                        opt.modelName === 'customModel'
                          ? !session.apiMode && session.modelName === 'customModel'
                          : session.apiMode
                          ? opt.apiMode && isApiModeSelected(opt.apiMode, session)
                          : !session.apiMode && session.modelName === opt.modelName
                      return (
                        <button
                          type="button"
                          key={opt.id || opt.modelName}
                          onClick={() => applyModelSelection(opt)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '10px',
                            width: '100%',
                            padding: '10px 12px',
                            border: 'none',
                            background: selected ? 'var(--secondary)' : 'transparent',
                            color: 'var(--foreground)',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: '13px',
                          }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {opt.label}
                          </span>
                          {selected && (
                            <Check size={16} style={{ flexShrink: 0, color: 'var(--primary)' }} />
                          )}
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
          {ENABLE_AGENT_FEATURES && (
            <div ref={agentPickerRef} style={{ position: 'relative', marginLeft: '8px' }}>
              <button
                type="button"
                className="normal-button"
                onClick={() => setAgentPickerOpen((v) => !v)}
                title={t('Assistant / Skills / MCP')}
              >
                {resolvedAssistant?.name || t('No assistant')}
                <ChevronDown size={16} style={{ flexShrink: 0, opacity: 0.8 }} />
              </button>
              {agentPickerOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: '6px',
                    zIndex: 1000,
                    minWidth: '320px',
                    maxWidth: '420px',
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.75rem',
                    overflow: 'hidden',
                    boxShadow: 'var(--shadow-lg)',
                  }}
                >
                  <div
                    style={{
                      padding: '12px',
                      borderBottom: '1px solid var(--border)',
                      background: 'var(--card)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    {!agentContextEnabled && (
                      <div
                        style={{
                          fontSize: '11px',
                          color: 'var(--muted-foreground)',
                          lineHeight: 1.4,
                        }}
                      >
                        {t(
                          'Assistant/Skills/MCP are disabled for ChatGPT Web models. Switch to API or Custom API to use agent context.',
                        )}
                      </div>
                    )}
                    <div style={{ fontSize: '12px', fontWeight: 600 }}>{t('Assistant')}</div>
                    <select
                      value={assistantSelectValue}
                      disabled={!agentContextEnabled}
                      onChange={(e) => {
                        if (!agentContextEnabled) return
                        const assistantId = e.target.value
                        setSession({
                          ...session,
                          assistantId,
                          selectedSkillIds: null,
                          selectedMcpServerIds: null,
                        })
                      }}
                      style={{
                        width: '100%',
                        height: '32px',
                        border: '1px solid var(--border)',
                        background: 'var(--input)',
                        color: 'var(--foreground)',
                        borderRadius: '0.5rem',
                        padding: '0 10px',
                        fontSize: '13px',
                      }}
                    >
                      <option value="">{t('None')}</option>
                      {assistants.map((assistant) => (
                        <option key={assistant.id} value={assistant.id}>
                          {assistant.name}
                        </option>
                      ))}
                    </select>
                    <div style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>
                      {t('Runtime mode')}: {config.runtimeMode || 'safe'}
                    </div>
                  </div>

                  <div style={{ padding: '12px', maxHeight: '360px', overflow: 'auto' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600 }}>{t('System Prompt')}</div>
                      <textarea
                        value={session.systemPromptOverride || ''}
                        disabled={!agentContextEnabled}
                        onChange={(e) => {
                          if (!agentContextEnabled) return
                          setSession({ ...session, systemPromptOverride: e.target.value })
                        }}
                        placeholder={resolvedAssistant?.systemPrompt || t('Optional override')}
                        style={{
                          width: '100%',
                          minHeight: '72px',
                          border: '1px solid var(--border)',
                          background: 'var(--input)',
                          color: 'var(--foreground)',
                          borderRadius: '0.5rem',
                          padding: '8px 10px',
                          fontSize: '12px',
                          resize: 'vertical',
                        }}
                      />

                      <div style={{ fontSize: '12px', fontWeight: 600 }}>{t('Skills')}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {skills.length === 0 && (
                          <div style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>
                            {t('No skills configured')}
                          </div>
                        )}
                        {skills.map((skill) => (
                          <label
                            key={skill.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              fontSize: '12px',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedSkillIds.includes(skill.id)}
                              disabled={!agentContextEnabled}
                              onChange={() => {
                                if (!agentContextEnabled) return
                                setSession({
                                  ...session,
                                  selectedSkillIds: toggleSelectedId(selectedSkillIds, skill.id),
                                })
                              }}
                            />
                            <span>
                              {skill.name}
                              {skill.version ? ` (v${skill.version})` : ''}
                            </span>
                          </label>
                        ))}
                      </div>

                      <div style={{ fontSize: '12px', fontWeight: 600 }}>{t('MCP')}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {mcpServers.length === 0 && (
                          <div style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>
                            {t('No MCP servers configured')}
                          </div>
                        )}
                        {mcpServers.map((server) => (
                          <label
                            key={server.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              fontSize: '12px',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedMcpServerIds.includes(server.id)}
                              disabled={!agentContextEnabled}
                              onChange={() => {
                                if (!agentContextEnabled) return
                                setSession({
                                  ...session,
                                  selectedMcpServerIds: toggleSelectedId(
                                    selectedMcpServerIds,
                                    server.id,
                                  ),
                                })
                              }}
                            />
                            <span>
                              {server.name} [{server.transport}]
                            </span>
                          </label>
                        ))}
                      </div>

                      <div style={{ fontSize: '12px', fontWeight: 600 }}>{t('Tool Trace')}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {recentToolEvents.length === 0 && (
                          <div style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>
                            {t('No tool events yet')}
                          </div>
                        )}
                        {recentToolEvents.map((event, index) => (
                          <div
                            key={`${event.createdAt || 'evt'}-${index}`}
                            style={{
                              fontSize: '11px',
                              color: 'var(--muted-foreground)',
                              border: '1px solid var(--border)',
                              borderRadius: '6px',
                              padding: '6px 8px',
                              background: 'var(--input)',
                            }}
                          >
                            <div>
                              {event.type || 'event'} / {event.status || 'unknown'}
                            </div>
                            <div>
                              {[event.serverName, event.toolName].filter(Boolean).join(' · ') ||
                                (event.reason ? event.reason : t('No details'))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </span>
        {props.draggable && !completeDraggable && (
          <div className="draggable" style={{ flexGrow: 2, cursor: 'move', height: '55px' }} />
        )}
        <span
          className="gpt-util-group"
          style={{
            padding: '15px 15px 15px 0',
            justifyContent: 'flex-end',
            flexGrow: props.draggable && !completeDraggable ? 0 : 1,
          }}
        >
          {!config.disableWebModeHistory && session && session.conversationId && (
            <a
              title={t('Continue on official website')}
              href={'https://chatgpt.com/chat/' + session.conversationId}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="gpt-util-icon"
              style="color: inherit;"
            >
              <ExternalLink size={16} />
            </a>
          )}
          <span
            className="gpt-util-icon"
            title={t('Float the Window')}
            onClick={() => {
              const position = { x: window.innerWidth / 2 - 300, y: window.innerHeight / 2 - 200 }
              const toolbarContainer = createElementAtPosition(position.x, position.y)
              toolbarContainer.className = 'chatgptbox-toolbar-container-not-queryable'
              render(
                <FloatingToolbar
                  session={session}
                  selection=""
                  container={toolbarContainer}
                  closeable={true}
                  triggered={true}
                />,
                toolbarContainer,
              )
            }}
          >
            <PanelRight size={16} />
          </span>
          <DeleteButton
            size={16}
            text={t('Clear Conversation')}
            onConfirm={async () => {
              await postMessage({ stop: true })
              Browser.runtime.sendMessage({
                type: RuntimeMessage.DeleteConversation,
                data: {
                  conversationId: session.conversationId,
                },
              })
              await deleteChatgptWebSessionSnapshot(session.sessionId).catch(() => {})
              setConversationItemData([])
              const newSession = initSession({
                ...session,
                question: null,
                conversationRecords: [],
              })
              newSession.sessionId = session.sessionId
              setSession(newSession)
            }}
          />
          {!props.pageMode && (
            <span
              title={t('Store to Independent Conversation Page')}
              className="gpt-util-icon"
              onClick={() => {
                const newSession = {
                  ...session,
                  sessionName: new Date().toLocaleString(),
                  autoClean: false,
                  sessionId: uuidv4(),
                }
                setSession(newSession)
                createSession(newSession).then(() =>
                  Browser.runtime.sendMessage({
                    type: RuntimeMessage.OpenUrl,
                    data: {
                      url: Browser.runtime.getURL('IndependentPanel.html') + '?from=store',
                    },
                  }),
                )
              }}
            >
              <Archive size={16} />
            </span>
          )}
          {conversationItemData.length > 0 && (
            <span
              title={t('Jump to bottom')}
              className="gpt-util-icon"
              onClick={() => {
                bodyRef.current.scrollTo({
                  top: bodyRef.current.scrollHeight,
                  behavior: 'smooth',
                })
              }}
            >
              <ArrowDown size={16} />
            </span>
          )}
          <span
            title={t('Save Conversation')}
            className="gpt-util-icon"
            onClick={() => {
              let output = ''
              session.conversationRecords.forEach((data) => {
                output += `${t('Question')}:\n\n${data.question}\n\n${t('Answer')}:\n\n${
                  data.answer
                }\n\n<hr/>\n\n`
              })
              const blob = new Blob([output], { type: 'text/plain;charset=utf-8' })
              FileSaver.saveAs(blob, 'conversation.md')
            }}
          >
            <Download size={16} />
          </span>
        </span>
      </div>
      <hr />
      <div
        ref={bodyRef}
        className="markdown-body"
        style={
          props.notClampSize
            ? { flexGrow: 1, overflow: 'auto' }
            : props.draggable
            ? { flexGrow: 1, overflow: 'auto' }
            : { maxHeight: windowSize[1] * 0.55 + 'px', resize: 'vertical', overflow: 'auto' }
        }
      >
        {conversationItemData.map((data, idx) => (
          <ConversationItem
            content={data.content}
            key={idx}
            type={data.type}
            descName={data.type === 'answer' && session.aiName}
            onRetry={idx === conversationItemData.length - 1 ? retryFn : null}
          />
        ))}
      </div>
      {props.waitForTrigger && !triggered ? (
        <p
          className="manual-btn"
          style={{ display: 'flex', justifyContent: 'center' }}
          onClick={() => {
            setConversationItemData([
              new ConversationItemData(
                'answer',
                `<p class="gpt-loading">${t(`Waiting for response...`)}</p>`,
              ),
            ])
            setTriggered(true)
            setIsReady(false)
          }}
        >
          <span className="icon-and-text">
            <Search size={16} /> {t('Ask ChatGPT')}
          </span>
        </p>
      ) : (
        <InputBox
          enabled={isReady}
          postMessage={postMessage}
          reverseResizeDir={props.pageMode}
          onSubmit={async (question) => {
            const newQuestion = new ConversationItemData('question', question)
            const newAnswer = new ConversationItemData(
              'answer',
              `<p class="gpt-loading">${t('Waiting for response...')}</p>`,
            )
            setConversationItemData([...conversationItemData, newQuestion, newAnswer])
            setIsReady(false)

            const newSession = withCurrentPageContext({ ...session, question, isRetry: false })
            setSession(newSession)
            try {
              await postMessage({ session: newSession })
            } catch (e) {
              updateAnswer(e, false, 'error')
            }
            bodyRef.current.scrollTo({
              top: bodyRef.current.scrollHeight,
              behavior: 'instant',
            })
          }}
        />
      )}
    </div>
  )
}

ConversationCard.propTypes = {
  session: PropTypes.object.isRequired,
  question: PropTypes.string,
  onUpdate: PropTypes.func,
  draggable: PropTypes.bool,
  closeable: PropTypes.bool,
  onClose: PropTypes.func,
  dockable: PropTypes.bool,
  onDock: PropTypes.func,
  notClampSize: PropTypes.bool,
  pageMode: PropTypes.bool,
  waitForTrigger: PropTypes.bool,
}

export default memo(ConversationCard)
