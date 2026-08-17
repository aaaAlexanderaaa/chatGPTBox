import { render } from 'preact'
import { App } from './app.jsx'
import './tokens.css'

// Full-page DeepSeek Harness. v1 theme: follow the system (design tokens
// dark-first defaults + [data-theme='auto'] media queries carry both modes).
document.documentElement.dataset.theme = 'auto'
document.body.style.margin = '0'

render(<App />, document.getElementById('app'))
