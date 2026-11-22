import { mountGenuiCharts } from './genui-chart-runtime.mjs'
import { mountDraftsCodeDiagrams } from './drafts-code-diagrams.mjs'
import { renderDraftsMath, wrapDraftsTables } from './drafts-math-runtime.mjs'

const media = window.matchMedia('(prefers-color-scheme: dark)')
let dispose = () => {}
let disposeDiagrams = () => {}
let generation = 0
let pending = Promise.resolve()

function root() {
  return document.querySelector('main') || document.body
}

function drawCharts() {
  dispose()
  dispose = mountGenuiCharts(root(), media.matches)
}

function drawDiagrams() {
  const current = ++generation
  const container = root()
  disposeDiagrams()
  pending = pending.then(async () => {
    if (current !== generation) return
    const diagrams = mountDraftsCodeDiagrams(container, media.matches)
    disposeDiagrams = diagrams.dispose
    await diagrams.ready
  })
}

function redraw() {
  drawCharts()
  drawDiagrams()
}

function enhance() {
  const container = root()
  renderDraftsMath(container)
  wrapDraftsTables(container)
  redraw()
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', enhance, { once: true })
else enhance()
media.addEventListener('change', redraw)
window.addEventListener(
  'pagehide',
  () => {
    generation++
    dispose()
    disposeDiagrams()
  },
  { once: true },
)
