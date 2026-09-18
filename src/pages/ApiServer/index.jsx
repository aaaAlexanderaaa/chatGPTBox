import { render } from 'preact'
import '../../_locales/i18n-react'
import App from './App'

document.body.style.margin = '0'
render(<App />, document.getElementById('app'))
