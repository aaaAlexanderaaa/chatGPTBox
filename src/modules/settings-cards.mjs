// UI-side module aggregation: registers settings-card components into the
// seam. Imported exactly once from the popup/options entries (see the
// sanctioned import points in .eslintrc.json) so the card JSX lands only in
// UI bundles — never in the background bundle.

import { registerSettingsCard } from './api.mjs'
import { DSH_MODULE_ID } from './dsh/module.mjs'
import { DshSettingsCard } from './dsh/ui/SettingsCard.jsx'
import { CHATGPTWEB_MODULE_ID } from './chatgptweb/module.mjs'
import { ChatgptWebSettingsCard } from './chatgptweb/ui/SettingsCard.jsx'

registerSettingsCard(DSH_MODULE_ID, DshSettingsCard)
registerSettingsCard(CHATGPTWEB_MODULE_ID, ChatgptWebSettingsCard)
