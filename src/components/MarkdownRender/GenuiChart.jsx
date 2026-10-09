import { useEffect, useRef } from 'react'
import PropTypes from 'prop-types'
import { mountGenuiChart } from './genui-chart-runtime.mjs'
import { parseGenuiChartDescriptor } from '../../services/clients/chatgpt-web/genui-charts.mjs'

// ReactMarkdown owns the data table; the chart library only owns its empty
// viewport. Re-renders and theme changes dispose the previous SVG and listeners.
export function GenuiChart({ node, children, ...props }) {
  const root = useRef(null)
  const serialized = node?.properties?.dataChatgptboxChart || props['data-chatgptbox-chart']
  useEffect(() => {
    if (!serialized || !root.current) return
    let dispose = () => {}
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const draw = () => {
      dispose()
      try {
        const theme = root.current.closest('[data-theme]')?.getAttribute('data-theme')
        dispose = mountGenuiChart(root.current, parseGenuiChartDescriptor(serialized), {
          dark: theme === 'dark' || ((!theme || theme === 'auto') && media.matches),
        })
      } catch {
        /* Keep the data table on invalid descriptors. */
      }
    }
    draw()
    media.addEventListener('change', draw)
    const observer = new MutationObserver(draw)
    const theme = root.current.closest('[data-theme]')
    if (theme) observer.observe(theme, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      dispose()
      observer.disconnect()
      media.removeEventListener('change', draw)
    }
  }, [serialized])
  return (
    <div {...props} ref={root}>
      {children}
    </div>
  )
}
GenuiChart.propTypes = {
  node: PropTypes.object,
  children: PropTypes.node,
  'data-chatgptbox-chart': PropTypes.string,
}
