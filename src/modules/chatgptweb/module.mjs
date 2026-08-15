// ChatGPT Web module manifest (data only — see ../index.mjs).
//
// Roadmap C1 (D-3): the ChatGPT Web feature set is FROZEN — protocol and
// behavior move one line at most. What this module owns is the roof over
// its settings: endpoint configuration, history sync, backup, and the
// debug viewer used to live as scattered sections of the Advanced tab;
// they now live here as one addressed place. The runtime services stay in
// the extension core (they are wired into the background service worker
// and the proxy tab lifecycle); only the settings surface moved.
//
// settingsPlacement 'engines': the unified engine anatomy tab (C2) is the
// card's home; the interim 'advanced' placement existed only for the frozen
// migration step (C1).

export const CHATGPTWEB_MODULE_ID = 'chatgptweb'

export const chatgptWebModule = {
  id: CHATGPTWEB_MODULE_ID,
  label: 'ChatGPT Web',
  settingsPlacement: 'engines',
}
