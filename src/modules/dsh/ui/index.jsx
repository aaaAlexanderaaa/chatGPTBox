import { render } from 'preact'
import { Cockpit } from './Cockpit.jsx'
import './dsh.css'

// Full-page agent cockpit (roadmap A3 / ui-console.md). v1 theme: follow the
// system (the design tokens dark-first defaults + [data-theme='auto'] media
// queries carry both modes).
document.documentElement.dataset.theme = 'auto'
document.body.style.margin = '0'

render(<Cockpit />, document.getElementById('app'))
