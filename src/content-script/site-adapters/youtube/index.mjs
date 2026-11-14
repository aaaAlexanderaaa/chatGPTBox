import { captureContext, acquireReadingSnapshot } from '../../../browser-assistant/context.mjs'
import { createYouTubeSummaryPrompt } from '../../../browser-assistant/youtube.mjs'
import { config } from '../index.mjs'
import { logAdapterError, safeAdapter } from '../_helpers.mjs'

export default {
  init: async (hostname, userConfig, getInput, mountComponent) => {
    try {
      let oldUrl = location.href
      window.setInterval(() => {
        if (location.href !== oldUrl) {
          oldUrl = location.href
          mountComponent('youtube', config.youtube)
        }
      }, 500)
    } catch (error) {
      logAdapterError('youtube.init', error)
    }
    return true
  },
  inputQuery: safeAdapter('youtube.inputQuery', async () =>
    createYouTubeSummaryPrompt(await acquireReadingSnapshot(captureContext())),
  ),
}
