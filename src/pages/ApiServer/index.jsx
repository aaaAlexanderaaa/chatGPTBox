import { render } from 'preact'
import App from './App'

document.body.style.margin = '0'
document.body.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
render(<App />, document.getElementById('app'))
