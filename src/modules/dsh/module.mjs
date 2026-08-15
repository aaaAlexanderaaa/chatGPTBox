// DeepSeek Harness module manifest (data only — see ../index.mjs).
//
// The module integrates a locally running `dsh web` instance as an L3 agent
// engine: a persistent background gateway (mux + host stream subscription,
// session registry, approval routing) plus a full-page cockpit (dsh.html).
// Everything ships behind dshModuleEnabled, default off — with the module
// disabled the extension behaves exactly as before (roadmap Phase A
// acceptance #5).

export const DSH_MODULE_ID = 'dsh'

export const dshModule = {
  id: DSH_MODULE_ID,
  label: 'DeepSeek Harness',
  configDefaults: {
    /** Master switch. Default off: an engine card, nothing more (D-2). */
    dshModuleEnabled: false,
    /**
     * Harness origin. Loopback by default — the trust fence on the harness
     * side pins privileged methods to loopback and the extension honors the
     * same assumption (D-13: we do not touch settings/credentials methods).
     */
    dshEndpoint: 'http://127.0.0.1:3080',
  },
  hasBackground: true,
  consolePage: 'dsh.html',
}
