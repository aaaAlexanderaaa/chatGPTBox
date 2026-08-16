// Grok Web module manifest (data only — see ../index.mjs).
//
// Settings roof for the grok.com L2 engine: login CTA when signed out,
// account tier + available models when signed in. Runtime (probe, proxy,
// provider) stays in the extension core; only the engines-tab card lives here.

export const GROKWEB_MODULE_ID = 'grokweb'

export const grokwebModule = {
  id: GROKWEB_MODULE_ID,
  label: 'Grok Web',
  settingsPlacement: 'engines',
}
