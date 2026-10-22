import { render } from 'preact'
import { BrowserAssistant } from './Assistant.jsx'
import { applyChatGptBoxAppearance } from '../utils/appearance.mjs'
import './styles.css'

export function openBrowserAssistant({ context, config, siteEngine, functionId, autoRun }) {
  const old = context.document.querySelector('[data-chatgptbox-assistant]')
  if (old) {
    render(null, old)
    old.remove()
  }
  const container = context.document.createElement('div')
  container.setAttribute('data-chatgptbox-assistant', '')
  const theme =
    config.themeMode === 'auto'
      ? context.document.defaultView.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : config.themeMode
  container.dataset.theme = theme
  applyChatGptBoxAppearance(container, config, theme)
  context.document.body.append(container)
  const close = () => {
    render(null, container)
    container.remove()
  }
  render(
    <BrowserAssistant
      context={context}
      initialConfig={config}
      siteEngine={siteEngine}
      onClose={close}
      functionId={functionId}
      autoRun={autoRun}
    />,
    container,
  )
}
