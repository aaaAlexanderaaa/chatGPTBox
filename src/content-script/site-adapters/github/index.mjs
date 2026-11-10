import { captureContext, captureReadingSnapshot } from '../../../browser-assistant/context.mjs'
import { limitedFetch } from '../../../utils'
import { cropText } from '../../../utils/crop-text.mjs'
import { config } from '../index.mjs'
import { logAdapterError, safeAdapter } from '../_helpers.mjs'

const getPatchUrl = async () => {
  const patchUrl = location.origin + location.pathname + '.patch'
  const response = await fetch(patchUrl, { method: 'HEAD' }).catch(() => ({}))
  if (response.ok) return patchUrl
  return ''
}

const getPatchData = async (patchUrl) => {
  if (!patchUrl) return

  let patchData = await limitedFetch(patchUrl, 1024 * 40)
  patchData = patchData.substring(patchData.indexOf('---'))
  return patchData
}

const isPull = () => {
  return location.pathname.match(/\/pull\/\d+$/)
}

const isIssue = () => {
  return location.pathname.match(/\/issues\/\d+$/)
}

export function acquireGitHubDiscussion(doc = document) {
  return captureReadingSnapshot(captureContext({ doc }), 'page')
}

export function createGitHubDiscussionPrompt(snapshot, issue = true) {
  const instruction = issue
    ? 'Summarize this GitHub issue: the problem, evidence, proposed solutions and open questions.'
    : 'Summarize this GitHub pull request discussion: the changes, review concerns and current status.'
  const material = snapshot.blocks.map((block) => `[${block.ref}] ${block.text}`).join('\n\n')
  return `${instruction}\nOnly the already-loaded discussion bodies below are included; unsent drafts are excluded.${
    snapshot.truncated ? ' The material is shortened to this preview.' : ''
  }\n\n${JSON.stringify({ material })}`
}

export default {
  init: async (hostname, userConfig, getInput, mountComponent) => {
    try {
      let oldUrl = location.href
      const checkUrlChange = async () => {
        if (location.href !== oldUrl) {
          oldUrl = location.href
          if (isPull() || isIssue()) {
            mountComponent('github', config.github)
            return
          }

          const patchUrl = await getPatchUrl()
          if (patchUrl) {
            mountComponent('github', config.github)
          }
        }
      }
      window.setInterval(checkUrlChange, 500)
    } catch (e) {
      logAdapterError('github.init', e)
    }
    return (await getPatchUrl()) || isPull() || isIssue()
  },
  inputQuery: safeAdapter('github.inputQuery', async () => {
    if (isPull() || isIssue()) {
      return createGitHubDiscussionPrompt(acquireGitHubDiscussion(), !!isIssue())
    }
    const patchUrl = await getPatchUrl()
    const patchData = await getPatchData(patchUrl)
    if (!patchData) return

    return await cropText(
      `You are an expert in analyzing git commits and crafting clear, concise commit messages. ` +
        `Based on the following git patch, please perform two tasks:\n` +
        `1. Generate a suitable commit message. It should follow standard conventions: a short imperative subject line (max 50 chars), ` +
        `followed by a blank line and a more detailed body if necessary, explaining the "what" and "why" of the changes.\n` +
        `2. Provide a brief summary of the changes introduced in this commit, highlighting the main purpose and impact.\n\n` +
        `The patch contents are as follows:\n${patchData}`,
    )
  }),
}
