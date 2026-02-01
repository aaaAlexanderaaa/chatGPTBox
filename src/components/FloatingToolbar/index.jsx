import { useCallback, useEffect, useState } from 'react'
import ConversationCard from '../ConversationCard'
import PropTypes from 'prop-types'
import { config as toolsConfig } from '../../content-script/selection-tools'
import { getClientPosition, isMobile, setElementPositionInViewport } from '../../utils'
import Draggable from 'react-draggable'
import { useTranslation } from 'react-i18next'
import { useConfig } from '../../hooks/use-config.mjs'
import { useWindowTheme } from '../../hooks/use-window-theme.mjs'
import {
  Languages,
  FileText,
  Lightbulb,
  Sparkles,
  Code,
  HelpCircle,
  Globe,
  Smile,
  SplitSquareVertical,
  Quote,
  Star,
  Wand2,
  PenLine,
  BookOpen,
  Clipboard,
} from 'lucide-react'
import { applyChatGptBoxAppearance } from '../../utils/appearance.mjs'

// Tool icon mapping (colors handled in CSS by [data-tool])
const TOOL_ICONS = {
  translate: { icon: Languages },
  summary: { icon: FileText },
  explain: { icon: Lightbulb },
  polish: { icon: Sparkles },
  code: { icon: Code },
  ask: { icon: HelpCircle },
  translateToEn: { icon: Globe },
  translateToZh: { icon: Globe },
  translateBidi: { icon: Globe },
  sentiment: { icon: Smile },
  divide: { icon: SplitSquareVertical },

  // Extra icons for custom tools
  star: { icon: Star },
  wand: { icon: Wand2 },
  quote: { icon: Quote },
  pen: { icon: PenLine },
  book: { icon: BookOpen },
  clipboard: { icon: Clipboard },
}

function FloatingToolbar(props) {
  const { t } = useTranslation()
  const [selection, setSelection] = useState(props.selection)
  const [prompt, setPrompt] = useState(props.prompt)
  const [triggered, setTriggered] = useState(props.triggered)
  const [render, setRender] = useState(false)
  const [closeable, setCloseable] = useState(props.closeable)
  const [position, setPosition] = useState(getClientPosition(props.container))
  const [virtualPosition, setVirtualPosition] = useState({ x: 0, y: 0 })
  const windowTheme = useWindowTheme()
  const config = useConfig(() => {
    setRender(true)
    if (!triggered && selection) {
      props.container.style.position = 'absolute'
      setTimeout(() => {
        const left = Math.min(
          Math.max(0, window.innerWidth - props.container.offsetWidth - 30),
          Math.max(0, position.x),
        )
        props.container.style.left = left + 'px'
      })
    }
  })
  const resolvedTheme = config.themeMode === 'auto' ? windowTheme : config.themeMode

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

  const updatePosition = useCallback(() => {
    const newPosition = setElementPositionInViewport(props.container, position.x, position.y)
    if (position.x !== newPosition.x || position.y !== newPosition.y) setPosition(newPosition)
  }, [props.container, position.x, position.y])

  const onClose = useCallback(() => {
    props.container.remove()
  }, [props.container])

  const onDock = useCallback(() => {
    props.container.className = 'chatgptbox-toolbar-container-not-queryable'
    setCloseable(true)
  }, [props.container])

  const onUpdate = useCallback(() => {
    updatePosition()
  }, [updatePosition])

  useEffect(() => {
    if (isMobile()) {
      const selectionListener = () => {
        const currentSelection = window.getSelection()?.toString()
        if (currentSelection) setSelection(currentSelection)
      }
      document.addEventListener('selectionchange', selectionListener)
      return () => {
        document.removeEventListener('selectionchange', selectionListener)
      }
    }
  }, [])

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
    const hasActiveBuiltinTools = (config.activeSelectionTools || []).length > 0
    const hasActiveCustomTools = (config.customSelectionTools || []).some(
      (tool) => tool?.name && tool.active !== false,
    )
    if (!hasActiveBuiltinTools && !hasActiveCustomTools) return <div />

    const tools = []
    const pushTool = ({ key, iconKey, name, genPrompt }) => {
      const toolConfig = TOOL_ICONS[iconKey] || { icon: HelpCircle }
      const Icon = toolConfig.icon

      tools.push(
        <button
          key={key}
          data-tool={iconKey}
          className="chatgptbox-selection-toolbar-button"
          title={name}
          onClick={async () => {
            const p = getClientPosition(props.container)
            props.container.style.position = 'fixed'
            setPosition(p)
            setPrompt(await genPrompt(selection))
            setTriggered(true)
          }}
        >
          <Icon size={16} />
        </button>,
      )
    }

    for (const key in toolsConfig) {
      if ((config.activeSelectionTools || []).includes(key)) {
        const toolConfig = toolsConfig[key]
        pushTool({ key, iconKey: key, name: t(toolConfig.label), genPrompt: toolConfig.genPrompt })
      }
    }
    for (const [index, tool] of (config.customSelectionTools || []).entries()) {
      if (tool?.name && tool.active !== false) {
        pushTool({
          key: `custom_${index}`,
          iconKey: tool.iconKey || 'ask',
          name: tool.name,
          genPrompt: async (selection) => {
            return tool.prompt.replace('{{selection}}', selection)
          },
        })
      }
    }

    return (
      <div data-theme={resolvedTheme}>
        <div className="chatgptbox-selection-toolbar">{tools}</div>
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
}

export default FloatingToolbar
