import { getPage, registerPage } from '../registry.mjs'
import { SettingsPage } from './SettingsPage.jsx'

if (!getPage('settings')) {
  registerPage({ id: 'settings', title: 'Settings', render: SettingsPage })
}
