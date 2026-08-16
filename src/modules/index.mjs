// Static module registry — the single place module manifests are imported.
//
// Both the background entry and every UI entry import this file (directly or
// via config/storage.mjs) so the registry is populated before anything reads
// it. Manifests must stay data-only: this file is reachable from every
// bundle, and a code import here would drag service/websocket code into
// popup/options. Background starters live in background-services.mjs;
// settings cards in settings-cards.mjs.

import { registerModule } from './api.mjs'
import { dshModule } from './dsh/module.mjs'
import { chatgptWebModule } from './chatgptweb/module.mjs'
import { grokwebModule } from './grokweb/module.mjs'

registerModule(dshModule)
registerModule(chatgptWebModule)
registerModule(grokwebModule)

// Re-export the read-side of the seam so core consumers (config storage,
// settings UI) can import the registry from this single aggregation point.
export { getModuleConfigDefaults, getModules, getModule } from './api.mjs'
