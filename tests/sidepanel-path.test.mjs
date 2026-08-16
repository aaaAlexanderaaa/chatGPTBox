import { describe, expect, it } from 'vitest'
import {
  createSidePanelPathStore,
  whitelistSidePanelPath,
} from '../src/background/sidepanel-path.mjs'

describe('whitelistSidePanelPath', () => {
  it('only allows the dsh cockpit or the default independent panel', () => {
    expect(whitelistSidePanelPath('dsh.html')).toBe('dsh.html')
    expect(whitelistSidePanelPath('IndependentPanel.html')).toBe('IndependentPanel.html')
    expect(whitelistSidePanelPath('https://evil.example/x.html')).toBe('IndependentPanel.html')
    expect(whitelistSidePanelPath(undefined)).toBe('IndependentPanel.html')
  })
})

describe('side panel path store', () => {
  it('remembers dsh.html for a tab so later tab updates do not snap back', () => {
    const store = createSidePanelPathStore()
    expect(store.pathFor(12)).toBe('IndependentPanel.html')
    store.remember(12, 'dsh.html')
    expect(store.pathFor(12)).toBe('dsh.html')
    expect(store.pathFor(99)).toBe('IndependentPanel.html')
    store.forget(12)
    expect(store.pathFor(12)).toBe('IndependentPanel.html')
  })
})
