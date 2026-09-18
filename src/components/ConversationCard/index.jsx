import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import Browser from 'webextension-polyfill'
import InputBox from '../InputBox'
import ConversationItem from '../ConversationItem'
import { createElementAtPosition, isFirefox, isMobile, isSafari } from '../../utils'
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
import { visibleApiModesForConfig } from '../../popup/components/engine-options.mjs'
import { engineSelectionLabel, getSelectionString } from '../../config/engine-selection.mjs'
import {
  isUsingChatgptWebModel,
  isUsingDshHarnessModel,
  isUsingGrokWebModel,
} from '../../config/predicates.mjs'
import { grokWebConversationUrl } from '../../config/grok-web.mjs'
import { useTranslation } from 'react-i18next'
import DeleteButton from '../DeleteButton'
import { useConfig } from '../../hooks/use-config.mjs'
import { useConversationRuntime } from '../../hooks/useConversationRuntime.mjs'
import { createSession } from '../../services/local-session.mjs'
import { v4 as uuidv4 } from 'uuid'
import { initSession } from '../../services/init-session.mjs'
import {
  deleteChatgptWebSessionSnapshot,
  restoreChatgptWebSessionSnapshot,
  saveChatgptWebSessionSnapshot,
} from '../../services/clients/chatgpt-web/thread-state.mjs'
import {
  deleteGrokWebSessionSnapshot,
  restoreGrokWebSessionOnto,
  saveGrokWebSessionSnapshot,
} from '../../services/clients/grok-web/thread-state.mjs'
import { RuntimeMessage } from '../../protocol/messages.mjs'
import {
  cockpitHrefForSession,
  buildQuestionAnswers,
  decisionsAfterRespond,
} from './dsh-decision-state.mjs'

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
  const {
    state: runtimeState,
    setSession,
    actions: runtimeActions,
  } = useConversationRuntime({
    initialSession: props.session,
    t,
    hasInitialQuestion: !!props.question,
  })
  const session = runtimeState.session
  const isReady = runtimeState.isReady
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
  const [apiModes, setApiModes] = useState([])
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [modelPickerQuery, setModelPickerQuery] = useState('')
  const [dshDecisions, setDshDecisions] = useState([])
  const [engineMemoryNote, setEngineMemoryNote] = useState('')
  const modelPickerRef = useRef(null)
  const modelPickerInputRef = useRef(null)

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
    if (isUsingGrokWebModel(session)) {
      if (session.conversationId && session.previousResponseID) return () => {}
    } else if (session.conversationId || session.parentMessageId || session.wsRequestId) {
      return () => {}
    }

    const restore = isUsingGrokWebModel(session)
      ? restoreGrokWebSessionOnto(session)
      : restoreChatgptWebSessionSnapshot(session)
    void restore
      .then((restoredSession) => {
        if (cancelled || !restoredSession || restoredSession === session) return
        if (
          restoredSession.conversationId === session.conversationId &&
          restoredSession.parentMessageId === session.parentMessageId &&
          restoredSession.messageId === session.messageId &&
          restoredSession.wsRequestId === session.wsRequestId &&
          restoredSession.previousResponseID === session.previousResponseID
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
    if (isUsingGrokWebModel(session)) {
      if (!session.conversationId || !session.previousResponseID) return
      void saveGrokWebSessionSnapshot(session).catch(() => {})
      return
    }
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
    session?.previousResponseID,
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
      const restoredSession = await (isUsingGrokWebModel(session)
        ? restoreGrokWebSessionOnto(session)
        : restoreChatgptWebSessionSnapshot(session)
      ).catch(() => session)
      if (cancelled) return
      const newSession = {
        ...(restoredSession && typeof restoredSession === 'object' ? restoredSession : session),
        question: props.question,
        updatedAt: new Date().toISOString(),
      }
      setSession(newSession)
      await postMessage({ session: newSession })
    })()

    return () => {
      cancelled = true
    }
  }, [props.question, triggered]) // usually only triggered once

  useLayoutEffect(() => {
    const selected = getSelectionString(session)
    setApiModes(visibleApiModesForConfig(config, selected))
  }, [
    config.l1Providers,
    config.chatgptWebEnabled,
    config.chatgptWebEnabledModels,
    config.chatgptWebAccountModels,
    config.grokWebEnabled,
    config.grokWebEnabledModels,
    config.grokWebAccountModels,
    config.dshModuleEnabled,
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

  /**
   * @param {string} value
   * @param {boolean} appended
   * @param {'question'|'answer'|'error'} newType
   * @param {boolean} done
   */
  // updateAnswer + portMessageListener (now dispatchInbound) moved into
  // useConversationRuntime. The inbound-message reducer is transport-agnostic;
  // the port subscription effect below wires it to port.onMessage.

  /**
   * @param {Session|undefined} session
   * @param {boolean|undefined} stop
   */
  const postMessage = async ({ session, stop }) => {
    port.postMessage({ session, stop })
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
  // dsh bridge messages ride the same port: decisions render as cards, the
  // session binding (dshSessionId) is kept on the session; everything else
  // goes to the runtime reducer.
  useEffect(() => {
    const listener = (msg) => {
      if (msg && typeof msg === 'object' && 'dshDecision' in msg) {
        const decision = msg.dshDecision
        setDshDecisions((prev) => {
          const key = `${decision.kind}:${decision.approvalId ?? decision.rpcId}`
          const next = prev.filter(
            (item) => `${item.kind}:${item.approvalId ?? item.rpcId}` !== key,
          )
          if (decision.status === 'pending') next.push(decision)
          return next
        })
        return
      }
      if (msg && typeof msg === 'object' && 'dshSessionId' in msg) {
        setSession((prev) =>
          prev && prev.dshSessionId !== msg.dshSessionId
            ? { ...prev, dshSessionId: msg.dshSessionId }
            : prev,
        )
        return
      }
      dispatchInbound(msg)
    }
    port.onMessage.addListener(listener)
    return () => {
      port.onMessage.removeListener(listener)
    }
  }, [port, dispatchInbound, setSession])

  // Retry state machine lives in useConversationRuntime.buildRetry; it needs the
  // transport `postMessage` to (re)send, which we inject here so the runtime
  // stays transport-agnostic and unit-testable.
  const getRetryFn = (session) => buildRetry(session, postMessage)

  const retryFn = useMemo(() => getRetryFn(session), [session])

  const modelPickerOptions = useMemo(() => {
    const opts = apiModes
      .map((apiMode, index) => {
        const modelName = apiMode.engineSelection || apiMode.itemName
        const label = apiMode.displayName?.trim() || engineSelectionLabel(modelName, t)
        return label ? { id: `mode-${index}`, modelName, apiMode: null, label } : null
      })
      .filter(Boolean)

    const currentModelName = getSelectionString(session)
    if (currentModelName && !opts.some((o) => o.modelName === currentModelName)) {
      opts.unshift({
        id: 'session-current',
        modelName: currentModelName,
        apiMode: null,
        label: engineSelectionLabel(currentModelName, t),
      })
    }

    return opts
  }, [apiModes, session.apiMode, session.modelName, t])

  const filteredModelPickerOptions = useMemo(() => {
    const q = modelPickerQuery.trim().toLowerCase()
    if (!q) return modelPickerOptions
    return modelPickerOptions.filter((opt) => {
      const label = (opt.label || '').toLowerCase()
      const modelName = (opt.modelName || '').toLowerCase()
      return label.includes(q) || modelName.includes(q)
    })
  }, [modelPickerOptions, modelPickerQuery])

  // D-12: switching engines mid-conversation discloses the memory semantics
  // in one line — never a blocking confirm.
  const showMemoryNote = (nextModelName) => {
    if (isUsingChatgptWebModel({ modelName: nextModelName }))
      setEngineMemoryNote(t('ChatGPT Web keeps the conversation server-side'))
    else if (isUsingGrokWebModel({ modelName: nextModelName }))
      setEngineMemoryNote(t('Grok Web keeps the conversation server-side'))
    else if (isUsingDshHarnessModel({ modelName: nextModelName }))
      setEngineMemoryNote(t('The agent keeps the conversation engine-side'))
    else setEngineMemoryNote(t('History lives in this window and is re-sent'))
    setTimeout(() => setEngineMemoryNote(''), 6000)
  }

  const respondDshDecision = (decision, outcome) => {
    void (async () => {
      let receipt
      try {
        receipt = await Browser.runtime.sendMessage({
          type: RuntimeMessage.DshModuleRespond,
          data:
            decision.kind === 'question'
              ? {
                  kind: 'question',
                  rpcId: decision.rpcId,
                  sessionId: decision.sessionId,
                  answers: outcome,
                }
              : {
                  kind: 'approval',
                  rpcId: decision.rpcId,
                  sessionId: decision.sessionId,
                  approvalId: decision.approvalId,
                  outcome,
                },
        })
      } catch {
        receipt = { accepted: false }
      }
      setDshDecisions((prev) => decisionsAfterRespond(prev, decision, receipt))
    })()
  }

  const applyModelSelection = useCallback(
    ({ modelName }) => {
      const newSession = {
        ...session,
        modelName,
        apiMode: null,
        aiName: engineSelectionLabel(modelName, t),
      }
      showMemoryNote(modelName)
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
            padding: '0 0 0 4px',
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
                {engineSelectionLabel(getSelectionString(session), t)}
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
                      const selected = getSelectionString(session) === opt.modelName
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
        </span>
        {props.draggable && !completeDraggable && (
          <div className="draggable" style={{ flexGrow: 2, cursor: 'move' }} />
        )}
        <span
          className="gpt-util-group"
          style={{
            padding: '0 4px 0 0',
            justifyContent: 'flex-end',
            flexGrow: props.draggable && !completeDraggable ? 0 : 1,
          }}
        >
          {!config.disableWebModeHistory &&
            session &&
            session.conversationId &&
            isUsingChatgptWebModel(session) && (
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
          {!config.disableWebModeHistory &&
            session &&
            session.conversationId &&
            isUsingGrokWebModel(session) && (
              <a
                title={t('Continue on official website')}
                href={grokWebConversationUrl(session.conversationId)}
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
              if (isUsingChatgptWebModel(session) && session.conversationId) {
                Browser.runtime.sendMessage({
                  type: RuntimeMessage.DeleteConversation,
                  data: {
                    conversationId: session.conversationId,
                  },
                })
              }
              await deleteChatgptWebSessionSnapshot(session.sessionId).catch(() => {})
              await deleteGrokWebSessionSnapshot(session.sessionId).catch(() => {})
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
        <>
          {engineMemoryNote && (
            <div
              className="gpt-memory-note"
              style={{
                padding: '4px 15px',
                fontSize: '12px',
                color: 'var(--muted-foreground, #666)',
                borderTop: '1px dashed var(--border, #ddd)',
              }}
            >
              ℹ {engineMemoryNote}
            </div>
          )}
          {props.selection && isUsingDshHarnessModel(session) && (
            <div
              className="gpt-context-chip"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                margin: '6px 15px 0',
                padding: '3px 10px',
                fontSize: '12px',
                borderRadius: '999px',
                border: '1px solid var(--border, #ddd)',
                color: 'var(--muted-foreground, #666)',
                width: 'fit-content',
              }}
              title={t('Exactly what will be sent — nothing more')}
            >
              📄 {t('Selection attached')} · {props.selection.length} {t('chars')}
            </div>
          )}
          {dshDecisions.length > 0 && (
            <div style={{ padding: '0 15px' }}>
              {dshDecisions.map((decision) => (
                <DshDecisionCard
                  key={`${decision.kind}:${decision.approvalId ?? decision.rpcId}`}
                  decision={decision}
                  onRespond={respondDshDecision}
                  onCancelQuestion={(d) => {
                    void (async () => {
                      let receipt
                      try {
                        receipt = await Browser.runtime.sendMessage({
                          type: RuntimeMessage.DshModuleRespond,
                          data: {
                            kind: 'question-cancel',
                            rpcId: d.rpcId,
                            sessionId: d.sessionId,
                          },
                        })
                      } catch {
                        receipt = { accepted: false }
                      }
                      setDshDecisions((prev) => decisionsAfterRespond(prev, d, receipt))
                    })()
                  }}
                />
              ))}
            </div>
          )}
          <InputBox
            draftKey={props.draftKey}
            enabled={isReady}
            postMessage={postMessage}
            onSubmit={async (question) => {
              const newQuestion = new ConversationItemData('question', question)
              const newAnswer = new ConversationItemData(
                'answer',
                `<p class="gpt-loading">${t('Waiting for response...')}</p>`,
              )
              setConversationItemData([...conversationItemData, newQuestion, newAnswer])
              setIsReady(false)

              const newSession = { ...session, question, isRetry: false }
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
        </>
      )}
    </div>
  )
}

// Floating approval/question card (D-5): the floating window grows organs
// for L3 engines — the loudest element on the surface while pending.
function DshDecisionCard({ decision, onRespond, onCancelQuestion }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState({})
  const [custom, setCustom] = useState({})
  const amber = '#d97706' // the waiting color (ui-console D-17), one value

  if (decision.kind === 'approval') {
    return (
      <div
        style={{
          border: `1px solid ${amber}`,
          borderRadius: '8px',
          padding: '10px 12px',
          margin: '8px 0',
          background: 'var(--card, #fff)',
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 600, color: amber, marginBottom: '6px' }}>
          ⚠ {t('The agent is waiting for you')} · {decision.toolName}
        </div>
        <pre
          style={{
            margin: '0 0 8px',
            padding: '8px',
            maxHeight: '160px',
            overflow: 'auto',
            fontSize: '12px',
            whiteSpace: 'pre-wrap',
            background: 'var(--secondary, #f5f5f5)',
            borderRadius: '6px',
          }}
        >
          {decision.args || '(arguments not captured)'}
        </pre>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            style={{
              fontSize: '13px',
              padding: '5px 12px',
              borderRadius: '6px',
              border: 'none',
              background: amber,
              color: '#fff',
              cursor: 'pointer',
            }}
            onClick={() => onRespond(decision, 'allowed-once')}
          >
            {t('Allow once')}
          </button>
          <button
            style={{
              fontSize: '13px',
              padding: '5px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border, #ddd)',
              background: 'transparent',
              cursor: 'pointer',
            }}
            onClick={() => onRespond(decision, 'rejected')}
          >
            {t('Reject')}
          </button>
          <a
            href={cockpitHrefForSession(Browser.runtime.getURL('dsh.html'), decision.sessionId)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '12px', alignSelf: 'center', marginLeft: 'auto' }}
          >
            {t('Open DeepSeek Harness')}
          </a>
        </div>
      </div>
    )
  }

  const submit = () => {
    onRespond(decision, buildQuestionAnswers(decision.questions, selected, custom))
  }

  return (
    <div
      style={{
        border: `1px solid ${amber}`,
        borderRadius: '8px',
        padding: '10px 12px',
        margin: '8px 0',
        background: 'var(--card, #fff)',
      }}
    >
      <div style={{ fontSize: '12px', fontWeight: 600, color: amber, marginBottom: '6px' }}>
        ? {t('The agent is asking')}
      </div>
      {(decision.questions || []).map((question) => (
        <div key={question.id} style={{ marginBottom: '6px' }}>
          {question.header && (
            <p style={{ fontSize: '12px', margin: '0 0 2px' }}>{question.header}</p>
          )}
          <p style={{ fontSize: '13px', margin: '0 0 4px' }}>{question.question}</p>
          {question.options && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {question.options.map((option) => {
                const picked = (selected[question.id] || []).includes(option.label)
                return (
                  <label key={option.label} style={{ fontSize: '13px', cursor: 'pointer' }}>
                    <input
                      type={question.multiSelect ? 'checkbox' : 'radio'}
                      name={`fw-q-${decision.rpcId}-${question.id}`}
                      checked={picked}
                      onChange={() =>
                        setSelected((prev) => {
                          const current = prev[question.id] || []
                          if (question.multiSelect) {
                            return {
                              ...prev,
                              [question.id]: picked
                                ? current.filter((label) => label !== option.label)
                                : [...current, option.label],
                            }
                          }
                          return { ...prev, [question.id]: [option.label] }
                        })
                      }
                    />{' '}
                    {option.label}
                  </label>
                )
              })}
            </div>
          )}
          {!question.options && (
            <textarea
              rows={2}
              style={{ width: '100%', fontSize: '13px', boxSizing: 'border-box' }}
              placeholder={t('Type your answer…')}
              value={custom[question.id] || ''}
              onChange={(e) => setCustom((prev) => ({ ...prev, [question.id]: e.target.value }))}
            />
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          style={{
            fontSize: '13px',
            padding: '5px 12px',
            borderRadius: '6px',
            border: 'none',
            background: amber,
            color: '#fff',
            cursor: 'pointer',
          }}
          onClick={submit}
        >
          {t('Submit')}
        </button>
        <button
          style={{
            fontSize: '13px',
            padding: '5px 12px',
            borderRadius: '6px',
            border: '1px solid var(--border, #ddd)',
            background: 'transparent',
            cursor: 'pointer',
          }}
          onClick={() => onCancelQuestion(decision)}
        >
          {t('Dismiss')}
        </button>
      </div>
    </div>
  )
}

DshDecisionCard.propTypes = {
  decision: PropTypes.object.isRequired,
  onRespond: PropTypes.func.isRequired,
  onCancelQuestion: PropTypes.func.isRequired,
}

ConversationCard.propTypes = {
  session: PropTypes.object.isRequired,
  question: PropTypes.string,
  selection: PropTypes.string,
  draftKey: PropTypes.string,
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
