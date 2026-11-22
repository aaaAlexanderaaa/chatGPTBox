import { mountGenuiCharts } from './genui-chart-runtime.mjs'
import { renderDraftsMath, wrapDraftsTables } from './drafts-math-runtime.mjs'

const media = window.matchMedia('(prefers-color-scheme: dark)')
let dispose = () => {}
function root() {
  return document.querySelector('main') || document.body
}
function drawCharts() {
  dispose()
  dispose = mountGenuiCharts(root(), media.matches)
}
function enhance() {
  const container = root()
  renderDraftsMath(container)
  wrapDraftsTables(container)
  drawCharts()
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', enhance, { once: true })
else enhance()
media.addEventListener('change', drawCharts)
window.addEventListener('pagehide', () => dispose(), { once: true })
