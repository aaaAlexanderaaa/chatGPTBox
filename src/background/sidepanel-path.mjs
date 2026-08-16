// Per-tab side-panel path. OpenSidePanel may put the dsh cockpit in the
// panel; tabs.onUpdated must not snap every tab back to IndependentPanel.html.

export const DEFAULT_SIDE_PANEL_PATH = 'IndependentPanel.html'

export function whitelistSidePanelPath(requestedPath) {
  return requestedPath === 'dsh.html' ? 'dsh.html' : DEFAULT_SIDE_PANEL_PATH
}

export function createSidePanelPathStore() {
  const byTab = new Map()
  return {
    remember(tabId, path) {
      if (tabId == null) return
      byTab.set(tabId, whitelistSidePanelPath(path))
    },
    pathFor(tabId) {
      return byTab.get(tabId) || DEFAULT_SIDE_PANEL_PATH
    },
    forget(tabId) {
      byTab.delete(tabId)
    },
  }
}

export const sidePanelPaths = createSidePanelPathStore()
