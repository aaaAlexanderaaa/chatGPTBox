import { mountGenuiCharts } from './genui-chart-runtime.mjs'

const media = window.matchMedia('(prefers-color-scheme: dark)')
let dispose = () => {}
function draw() {
  dispose()
  dispose = mountGenuiCharts(document.querySelector('main') || document.body, media.matches)
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', draw, { once: true })
else draw()
media.addEventListener('change', draw)
window.addEventListener('pagehide', () => dispose(), { once: true })
