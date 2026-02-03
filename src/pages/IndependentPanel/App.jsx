import {
  createSession,
  resetSessions,
  getSessions,
  updateSession,
  getSession,
  deleteSession,
} from '../../services/local-session.mjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import '../../styles/globals.css'
import './styles-new.css'
import { useConfig } from '../../hooks/use-config.mjs'
import { setUserConfig } from '../../config/index.mjs'
import { useTranslation } from 'react-i18next'
import ConfirmButton from '../../components/ConfirmButton'
import ConversationCard from '../../components/ConversationCard'
import DeleteButton from '../../components/DeleteButton'
import { openUrl } from '../../utils/index.mjs'
import Browser from 'webextension-polyfill'
import FileSaver from 'file-saver'
import { cn } from '../../utils/cn.mjs'
import { useWindowTheme } from '../../hooks/use-window-theme.mjs'
import { applyChatGptBoxAppearance, applyDocumentAppearance } from '../../utils/appearance.mjs'
import {
  PanelLeftClose,
  PanelLeft,
  Plus,
  Download,
  Trash2,
  Settings,
  MessageSquare,
  Sun,
  Moon,
  Monitor,
  Search,
  X,
} from 'lucide-react'
import PropTypes from 'prop-types'

function App({ embedded = false, showSettingsButton = true, onOpenSettings } = {}) {
  const { t } = useTranslation()
  const [isNarrow, setIsNarrow] = useState(window.innerWidth < 480)
  const [collapsed, setCollapsed] = useState(isNarrow)
  const config = useConfig(null, false)
  const windowTheme = useWindowTheme()
  const resolvedTheme = config.themeMode === 'auto' ? windowTheme : config.themeMode
  const [sessions, setSessions] = useState([])
  const [sessionSearch, setSessionSearch] = useState('')
  const [debouncedSessionSearch, setDebouncedSessionSearch] = useState('')
  const [sessionId, setSessionId] = useState(null)
  const [currentSession, setCurrentSession] = useState(null)
  const [renderContent, setRenderContent] = useState(false)
  const currentPort = useRef(null)
  const chatRootRef = useRef(null)

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 480)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (isNarrow) setCollapsed(true)
    else setCollapsed(!!config.independentPanelSidebarCollapsed)
  }, [isNarrow, config.independentPanelSidebarCollapsed])

  const setSessionIdSafe = async (sessionId) => {
    if (currentPort.current) {
      try {
        currentPort.current.postMessage({ stop: true })
        currentPort.current.disconnect()
      } catch (e) {
        /* empty */
      }
      currentPort.current = null
    }
    const { session, currentSessions } = await getSession(sessionId)
    if (session) setSessionId(sessionId)
    else if (currentSessions.length > 0) setSessionId(currentSessions[0].sessionId)
  }

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    applyDocumentAppearance(document.documentElement, config, resolvedTheme)
  }, [
    resolvedTheme,
    config.accentColorLight,
    config.accentStrengthLight,
    config.accentColorDark,
    config.accentStrengthDark,
  ])

  useEffect(() => {
    if (chatRootRef.current) applyChatGptBoxAppearance(chatRootRef.current, config, resolvedTheme)
  }, [
    resolvedTheme,
    renderContent,
    config.accentColorLight,
    config.accentStrengthLight,
    config.accentColorDark,
    config.accentStrengthDark,
    config.codeThemeLight,
    config.codeThemeDark,
  ])

  useEffect(() => {
    // eslint-disable-next-line
    ;(async () => {
      const urlFrom = new URLSearchParams(window.location.search).get('from')
      const sessions = await getSessions()
      if (
        urlFrom !== 'store' &&
        sessions[0].conversationRecords &&
        sessions[0].conversationRecords.length > 0
      ) {
        await createNewChat()
      } else {
        setSessions(sessions)
        await setSessionIdSafe(sessions[0].sessionId)
      }
    })()
  }, [])

  useEffect(() => {
    if ('sessions' in config && config['sessions']) setSessions(config['sessions'])
  }, [config])

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSessionSearch(sessionSearch.trim().toLowerCase())
    }, 200)
    return () => clearTimeout(timer)
  }, [sessionSearch])

  useEffect(() => {
    // eslint-disable-next-line
    ;(async () => {
      if (sessions.length > 0) {
        setCurrentSession((await getSession(sessionId)).session)
        setRenderContent(false)
        setTimeout(() => {
          setRenderContent(true)
        })
      }
    })()
  }, [sessionId])

  const filteredSessions = useMemo(() => {
    if (!debouncedSessionSearch) return sessions
    return sessions.filter((session) => {
      const name = (session.sessionName || '').toLowerCase()
      const aiName = (session.aiName || '').toLowerCase()
      return name.includes(debouncedSessionSearch) || aiName.includes(debouncedSessionSearch)
    })
  }, [debouncedSessionSearch, sessions])

  const toggleSidebar = () => {
    const nextCollapsed = !collapsed
    setCollapsed(nextCollapsed)
    if (!isNarrow) setUserConfig({ independentPanelSidebarCollapsed: nextCollapsed })
  }

  const createNewChat = async () => {
    const { session, currentSessions } = await createSession()
    setSessions(currentSessions)
    await setSessionIdSafe(session.sessionId)
    if (isNarrow) setCollapsed(true)
  }

  const exportConversations = async () => {
    const sessions = await getSessions()
    const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: 'text/json;charset=utf-8' })
    FileSaver.saveAs(blob, 'conversations.json')
  }

  const clearConversations = async () => {
    const sessions = await resetSessions()
    setSessions(sessions)
    await setSessionIdSafe(sessions[0].sessionId)
  }

  return (
    <div
      className={cn(
        embedded ? 'h-full' : 'h-screen',
        'flex bg-background text-foreground overflow-hidden',
      )}
    >
      {/* Sidebar Backdrop (narrow screen) */}
      {isNarrow && !collapsed && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 bg-black/40"
          onClick={() => setCollapsed(true)}
        />
      )}

      {/* Sidebar */}
      <div
        className={cn(
          'flex flex-col border-r border-border bg-card overflow-hidden transition-all duration-300',
          isNarrow ? 'fixed left-0 top-0 bottom-0 z-50 w-60 min-w-[240px] shadow-xl' : 'relative',
          isNarrow
            ? collapsed
              ? '-translate-x-full pointer-events-none'
              : 'translate-x-0'
            : collapsed
            ? 'w-0 min-w-0 opacity-0'
            : 'w-60 min-w-[240px]',
        )}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">{t('Chats')}</h2>
            <button
              onClick={toggleSidebar}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={createNewChat}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            {t('New Chat')}
          </button>

          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={sessionSearch}
              onInput={(e) => setSessionSearch(e.target.value)}
              placeholder="Search chats…"
              className="w-full pl-9 pr-9 py-2 text-sm bg-secondary rounded-lg outline-none focus:ring-2 focus:ring-primary/20 text-foreground placeholder:text-muted-foreground"
            />
            {!!sessionSearch.trim() && (
              <button
                type="button"
                onClick={() => setSessionSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
          {filteredSessions.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No matching chats</div>
          ) : (
            filteredSessions.map((session, index) => (
              <div
                key={index}
                className={cn(
                  'group flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all mb-1',
                  sessionId === session.sessionId
                    ? 'bg-primary/10 border border-primary/20'
                    : 'hover:bg-secondary border border-transparent',
                )}
                onClick={async (e) => {
                  if (e.target instanceof Element) {
                    if (e.target.closest('.gpt-util-icon') || e.target.closest('.normal-button'))
                      return
                  }
                  await setSessionIdSafe(session.sessionId)
                  if (isNarrow) setCollapsed(true)
                }}
              >
                <div
                  className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                    sessionId === session.sessionId ? 'bg-primary/20' : 'bg-secondary',
                  )}
                >
                  <MessageSquare
                    className={cn(
                      'w-4 h-4',
                      sessionId === session.sessionId ? 'text-primary' : 'text-muted-foreground',
                    )}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {session.sessionName || t('New Chat')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {session.conversationRecords?.length || 0} {t('messages')}
                  </p>
                </div>
                <DeleteButton
                  size={14}
                  text={t('Delete')}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  onConfirm={() =>
                    deleteSession(session.sessionId).then((sessions) => {
                      setSessions(sessions)
                      setSessionIdSafe(sessions[0].sessionId)
                    })
                  }
                />
              </div>
            ))
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-border space-y-2">
          <button
            onClick={exportConversations}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" />
            {t('Export All')}
          </button>
          <ConfirmButton
            text={t('Clear All')}
            onConfirm={clearConversations}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
            icon={<Trash2 className="w-4 h-4" />}
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50">
          <div className="flex items-center gap-3">
            {collapsed && (
              <button
                onClick={toggleSidebar}
                className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              >
                <PanelLeft className="w-5 h-5" />
              </button>
            )}
            <h1 className="text-lg font-semibold text-foreground">
              {currentSession?.sessionName || t('ChatGPTBox')}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {/* Theme Switcher */}
            <div className="flex gap-1 p-1 bg-secondary rounded-lg">
              <button
                className={cn(
                  'p-1.5 rounded-md transition-colors',
                  config.themeMode === 'light'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setUserConfig({ themeMode: 'light' })}
              >
                <Sun className="w-4 h-4" />
              </button>
              <button
                className={cn(
                  'p-1.5 rounded-md transition-colors',
                  config.themeMode === 'auto'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setUserConfig({ themeMode: 'auto' })}
              >
                <Monitor className="w-4 h-4" />
              </button>
              <button
                className={cn(
                  'p-1.5 rounded-md transition-colors',
                  config.themeMode === 'dark'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setUserConfig({ themeMode: 'dark' })}
              >
                <Moon className="w-4 h-4" />
              </button>
            </div>
            {showSettingsButton && (
              <button
                onClick={() => {
                  if (onOpenSettings) onOpenSettings()
                  else openUrl(Browser.runtime.getURL('popup.html'))
                }}
                className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              >
                <Settings className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Chat Content */}
        <div className="flex-1 overflow-hidden">
          {renderContent && currentSession && currentSession.conversationRecords && (
            <div ref={chatRootRef} className="chatgptbox-container h-full">
              <ConversationCard
                session={currentSession}
                notClampSize={true}
                pageMode={true}
                onUpdate={(port, session, cData) => {
                  currentPort.current = port
                  if (cData.length > 0 && cData[cData.length - 1].done) {
                    updateSession(session).then(setSessions)
                    setCurrentSession(session)
                  }
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App

App.propTypes = {
  embedded: PropTypes.bool,
  showSettingsButton: PropTypes.bool,
  onOpenSettings: PropTypes.func,
}
