import { useCallback, useEffect, useRef, useState } from 'react'
import { render as preactRender } from 'preact'
import ConversationCard from '../ConversationCard'
import PropTypes from 'prop-types'
import { getClientPosition, resolvePromptTemplate, setElementPositionInViewport } from '../../utils'
import Draggable from 'react-draggable'
import { useTranslation } from 'react-i18next'
import { useConfig } from '../../hooks/use-config.mjs'
import { useWindowTheme } from '../../hooks/use-window-theme.mjs'
import { HelpCircle, Wand2 } from 'lucide-react'
import { FUNCTION_ICONS } from '../../browser-assistant/icons.mjs'
import { applyChatGptBoxAppearance } from '../../utils/appearance.mjs'
import {
  selectedInputText,
  captureContext,
  captureReadingSnapshot,
} from '../../browser-assistant/context.mjs'
import {
  listFunctions,
  localizeFunction,
  canRunFunction,
} from '../../browser-assistant/catalog.mjs'
import { prepareFunctionRun } from '../../browser-assistant/functions.mjs'
import { getPreferredLanguage } from '../../config/language.mjs'
import { getSelectionString } from '../../config/engine-selection.mjs'

function FloatingToolbar(props) {
  const { t } = useTranslation()
  const [selection, setSelection] = useState(props.selection)
  const [prompt, setPrompt] = useState(props.prompt)
  const [triggered, setTriggered] = useState(props.triggered)
  const [render, setRender] = useState(false)
  const [closeable, setCloseable] = useState(props.closeable)
  const [position, setPosition] = useState(getClientPosition(props.container))
  const [virtualPosition, setVirtualPosition] = useState({ x: 0, y: 0 })
  const [isPreparingPrompt, setIsPreparingPrompt] = useState(false)
  const isPreparingPromptRef = useRef(false)
  const preventAutoCloseRef = useRef(false)
  const triggeredRef = useRef(triggered)
  const promptRef = useRef(prompt)
  const selectionRef = useRef(selection)
  const windowTheme = useWindowTheme()
  const config = useConfig(() => {
    setRender(true)
    if (!preventAutoCloseRef.current && !triggeredRef.current && selectionRef.current) {
      const currentPosition = getClientPosition(props.container)
      props.container.style.position = 'absolute'
      setTimeout(() => {
        const left = Math.min(
          Math.max(0, window.innerWidth - props.container.offsetWidth - 30),
          Math.max(0, currentPosition.x),
        )
        props.container.style.left = left + 'px'
      })
    }
  })
  const resolvedTheme = config.themeMode === 'auto' ? windowTheme : config.themeMode

  useEffect(() => {
    setSelection(props.selection)
  }, [props.selection])

  useEffect(() => {
    setPrompt(props.prompt)
  }, [props.prompt])

  useEffect(() => {
    setTriggered(props.triggered)
  }, [props.triggered])

  useEffect(() => {
    if (!props.container) return
    applyChatGptBoxAppearance(props.container, config, resolvedTheme)
  }, [
    resolvedTheme,
    config.accentColorLight,
    config.accentStrengthLight,
    config.accentColorDark,
    config.accentStrengthDark,
    config.codeThemeLight,
    config.codeThemeDark,
  ])

  useEffect(() => {
    triggeredRef.current = triggered
  }, [triggered])

  useEffect(() => {
    promptRef.current = prompt
  }, [prompt])

  useEffect(() => {
    selectionRef.current = selection
  }, [selection])

  useEffect(() => {
    isPreparingPromptRef.current = isPreparingPrompt
  }, [isPreparingPrompt])

  const removeContainer = useCallback(() => {
    try {
      preactRender(null, props.container)
    } catch {
      // ignore
    }
    props.container?.remove()
  }, [props.container])

  useEffect(() => {
    const selectionListener = () => {
      if (preventAutoCloseRef.current) return
      if (triggeredRef.current) return
      if (promptRef.current) return

      const currentSelection =
        selectedInputText(document.activeElement) ||
        window
          .getSelection()
          ?.toString()
          ?.trim()
          ?.replace(/^-+|-+$/g, '')

      if (!currentSelection) {
        removeContainer()
        return
      }

      setSelection(currentSelection)
    }

    document.addEventListener('selectionchange', selectionListener)
    selectionListener()
    return () => {
      document.removeEventListener('selectionchange', selectionListener)
    }
  }, [removeContainer])

  useEffect(() => {
    const releaseAutoCloseSuppression = (pointerType, releaseTarget) => {
      if (!preventAutoCloseRef.current) return

      const releasedInsideToolbar =
        releaseTarget && props.container?.contains && props.container.contains(releaseTarget)
      const delay = pointerType === 'touch' && releasedInsideToolbar ? 700 : 0
      setTimeout(() => {
        if (triggeredRef.current) return
        if (promptRef.current) return
        if (isPreparingPromptRef.current) return

        preventAutoCloseRef.current = false

        const currentSelection = window
          .getSelection()
          ?.toString()
          ?.trim()
          ?.replace(/^-+|-+$/g, '')
        if (!currentSelection) removeContainer()
      }, delay)
    }

    if (window.PointerEvent) {
      const handler = (e) => releaseAutoCloseSuppression(e.pointerType, e.target)
      window.addEventListener('pointerup', handler, true)
      window.addEventListener('pointercancel', handler, true)
      return () => {
        window.removeEventListener('pointerup', handler, true)
        window.removeEventListener('pointercancel', handler, true)
      }
    }

    const onMouseUp = (e) => releaseAutoCloseSuppression('mouse', e.target)
    const onTouchEnd = (e) => releaseAutoCloseSuppression('touch', e.target)
    window.addEventListener('mouseup', onMouseUp, true)
    window.addEventListener('touchend', onTouchEnd, true)
    window.addEventListener('touchcancel', onTouchEnd, true)
    return () => {
      window.removeEventListener('mouseup', onMouseUp, true)
      window.removeEventListener('touchend', onTouchEnd, true)
      window.removeEventListener('touchcancel', onTouchEnd, true)
    }
  }, [removeContainer])

  const updatePosition = useCallback(() => {
    const newPosition = setElementPositionInViewport(props.container, position.x, position.y)
    if (position.x !== newPosition.x || position.y !== newPosition.y) setPosition(newPosition)
  }, [props.container, position.x, position.y])

  const onClose = useCallback(() => {
    removeContainer()
  }, [removeContainer])

  const onDock = useCallback(() => {
    props.container.className = 'chatgptbox-toolbar-container-not-queryable'
    setCloseable(true)
  }, [props.container])

  const onUpdate = useCallback(() => {
    updatePosition()
  }, [updatePosition])

  if (!render) return <div />

  if (triggered || (prompt && !selection)) {
    const dragEvent = {
      onDrag: (e, ui) => {
        setVirtualPosition({ x: virtualPosition.x + ui.deltaX, y: virtualPosition.y + ui.deltaY })
      },
      onStop: () => {
        setPosition({ x: position.x + virtualPosition.x, y: position.y + virtualPosition.y })
        setVirtualPosition({ x: 0, y: 0 })
      },
    }

    if (virtualPosition.x === 0 && virtualPosition.y === 0) {
      updatePosition() // avoid jitter
    }

    if (config.alwaysPinWindow) onDock()

    return (
      <div data-theme={resolvedTheme}>
        <Draggable
          handle=".draggable"
          onDrag={dragEvent.onDrag}
          onStop={dragEvent.onStop}
          position={virtualPosition}
        >
          <div
            className="chatgptbox-selection-window"
            style={{
              width: '450px',
              maxWidth: '90vw',
              height: '600px',
              maxHeight: '90vh',
              resize: 'both',
              overflow: 'hidden',
            }}
          >
            <div className="chatgptbox-container" style={{ height: '100%', overflow: 'hidden' }}>
              <ConversationCard
                session={props.session}
                question={prompt}
                selection={selection}
                draftKey={`floating-draft-${props.session?.sessionId || 'adhoc'}`}
                draggable={true}
                closeable={closeable}
                onClose={onClose}
                dockable={props.dockable}
                onDock={onDock}
                onUpdate={onUpdate}
                waitForTrigger={prompt && !triggered && !selection}
              />
            </div>
          </div>
        </Draggable>
      </div>
    )
  } else {
    const context =
      props.functionContext || captureContext({ target: document.activeElement, selection })
    const available = listFunctions(config, { entry: 'selection-toolbar', context }).filter(
      (item) =>
        canRunFunction(item, context) &&
        (props.onOpenAssistant || item.legacyKey || item.source === 'legacy'),
    )
    if (!available.length && !props.onOpenAssistant) return <div />

    const tools = []
    const pushTool = ({ key, iconKey, name, genPrompt }) => {
      const Icon = FUNCTION_ICONS[iconKey]?.Icon || HelpCircle

      tools.push(
        <button
          key={key}
          data-tool={iconKey}
          className="chatgptbox-selection-toolbar-button"
          title={name}
          disabled={isPreparingPrompt}
          onPointerDownCapture={() => {
            preventAutoCloseRef.current = true
          }}
          onMouseDownCapture={() => {
            preventAutoCloseRef.current = true
          }}
          onTouchStartCapture={() => {
            preventAutoCloseRef.current = true
          }}
          onClick={async () => {
            preventAutoCloseRef.current = true
            isPreparingPromptRef.current = true
            setIsPreparingPrompt(true)
            try {
              if (props.onOpenAssistant) {
                props.onOpenAssistant(key)
                return
              }
              const p = getClientPosition(props.container)
              props.container.style.position = 'fixed'
              setPosition(p)
              const nextPrompt = await genPrompt(selection)
              promptRef.current = nextPrompt
              triggeredRef.current = true
              setPrompt(nextPrompt)
              setTriggered(true)
            } catch (err) {
              preventAutoCloseRef.current = false
              console.error('Selection tool prompt generation failed:', err)
            } finally {
              isPreparingPromptRef.current = false
              setIsPreparingPrompt(false)
            }
          }}
        >
          <Icon size={16} />
        </button>,
      )
    }

    for (const item of available) {
      const fn = localizeFunction(item, t)
      pushTool({
        key: fn.id,
        iconKey: fn.iconKey || 'ask',
        name: fn.name,
        genPrompt: async () => {
          const language = await getPreferredLanguage()
          return prepareFunctionRun({
            fn,
            context,
            config,
            siteEngine: getSelectionString(props.session),
            language,
            snapshot: fn.scope === 'page' ? captureReadingSnapshot(context) : undefined,
            resolveTemplate: (template, material) =>
              resolvePromptTemplate(template, {
                selection: material,
                customExtractors: config.customContentExtractors,
                allowFullHtml: false,
                pageContext: { title: context.title, url: context.url, language },
              }),
          }).prompt
        },
      })
    }

    return (
      <div data-theme={resolvedTheme}>
        <div className="chatgptbox-selection-toolbar">
          {props.onOpenAssistant && props.showFunctionPicker !== false && (
            <button
              className="chatgptbox-selection-toolbar-button"
              title={t('Functions…')}
              onPointerDownCapture={() => {
                preventAutoCloseRef.current = true
              }}
              onMouseDownCapture={() => {
                preventAutoCloseRef.current = true
              }}
              onClick={() => props.onOpenAssistant()}
            >
              <Wand2 size={16} />
            </button>
          )}
          {tools}
        </div>
      </div>
    )
  }
}

FloatingToolbar.propTypes = {
  session: PropTypes.object.isRequired,
  selection: PropTypes.string.isRequired,
  container: PropTypes.object.isRequired,
  triggered: PropTypes.bool,
  closeable: PropTypes.bool,
  dockable: PropTypes.bool,
  prompt: PropTypes.string,
  onOpenAssistant: PropTypes.func,
  functionContext: PropTypes.object,
  showFunctionPicker: PropTypes.bool,
}

export default FloatingToolbar
