import Browser from 'webextension-polyfill'
import { RuntimeMessage } from '../protocol/messages.mjs'
import { isNativeChatgptUrl } from '../native-chatgpt/editor.mjs'
import { isPasteJobId, PASTE_REVIEW_TTL_MS } from '../native-chatgpt/review-contract.mjs'

// Only addressing metadata and one-use capabilities enter the background.
// Worker restart loses these records: an old review must fail closed.
export function createNativePasteReviewService(browser) {
  const jobs = new Map()
  let listening = false
  const remove = (job, notify = true) => {
    if (jobs.get(job.id) !== job) return
    jobs.delete(job.id)
    clearTimeout(job.timer)
    if (notify)
      void browser.tabs
        .sendMessage(
          job.tabId,
          {
            type: RuntimeMessage.CancelNativePasteReview,
            data: { jobId: job.id, proof: job.proof },
          },
          { documentId: job.documentId, frameId: 0 },
        )
        .catch(() => {})
  }
  const removed = (tabId) => {
    for (const job of jobs.values())
      if (job.reviewTabId === tabId || job.tabId === tabId) remove(job)
  }
  const updated = (tabId, change) => {
    if (!change.url) return
    for (const job of jobs.values())
      if (job.reviewTabId === tabId && change.url !== job.reviewUrl) remove(job)
  }
  const sameSource = (sender, job) =>
    sender?.id === browser.runtime.id &&
    sender.frameId === 0 &&
    sender.tab?.id === job.tabId &&
    sender.documentId === job.documentId
  return {
    async open(message, sender) {
      if (
        sender?.id !== browser.runtime.id ||
        sender.frameId !== 0 ||
        !Number.isInteger(sender.tab?.id) ||
        !sender.documentId ||
        !isNativeChatgptUrl(sender.url) ||
        !isPasteJobId(message.data?.jobId)
      )
        throw new Error('The paste review request is not from a supported document.')
      if (!listening) {
        browser.tabs.onRemoved.addListener(removed)
        browser.tabs.onUpdated.addListener(updated)
        listening = true
      }
      for (const job of jobs.values()) if (sameSource(sender, job)) remove(job)
      if (jobs.size >= 32) throw new Error('Too many paste reviews. Close an existing review.')
      const url = new URL(browser.runtime.getURL('PasteReview.html'))
      url.searchParams.set('job', message.data.jobId)
      url.searchParams.set('tab', String(sender.tab.id))
      url.searchParams.set('document', sender.documentId)
      const job = {
        id: message.data.jobId,
        tabId: sender.tab.id,
        documentId: sender.documentId,
        reviewUrl: url.href,
        reviewTabId: null,
        proof: crypto.randomUUID(),
        authenticated: false,
        timer: null,
        opening: null,
      }
      if (jobs.has(job.id)) throw new Error('This paste review already exists.')
      jobs.set(job.id, job)
      job.timer = setTimeout(() => remove(job), PASTE_REVIEW_TTL_MS)
      job.timer.unref?.()
      job.opening = browser.windows
        .create({
          url: url.href,
          type: 'popup',
          width: 760,
          height: 760,
          focused: true,
        })
        .then(async (window) => {
          const reviewTabId = window.tabs?.[0]?.id
          if (!Number.isInteger(reviewTabId) || jobs.get(job.id) !== job) {
            if (window.id) await browser.windows.remove(window.id)
            throw new Error('Could not open the paste review window.')
          }
          job.reviewTabId = reviewTabId
          return {
            reviewTabId,
            reviewUrl: url.href,
            documentId: sender.documentId,
            proof: job.proof,
          }
        })
      try {
        return await job.opening
      } catch (error) {
        remove(job, false)
        throw error
      }
    },
    async authenticate(message, sender) {
      const job = jobs.get(message.data?.jobId)
      if (!job) throw new Error('This paste review has expired.')
      await job.opening
      if (
        jobs.get(job.id) !== job ||
        job.authenticated ||
        sender?.id !== browser.runtime.id ||
        sender.frameId !== 0 ||
        sender.tab?.id !== job.reviewTabId ||
        sender.tab.url !== job.reviewUrl ||
        sender.url !== job.reviewUrl ||
        typeof sender.documentId !== 'string' ||
        !sender.documentId
      )
        throw new Error('This paste review is not the authorized review document.')
      job.authenticated = true
      return { proof: job.proof }
    },
    close(message, sender) {
      const job = jobs.get(message.data?.jobId)
      if (job && sameSource(sender, job)) remove(job, false)
      return { closed: true }
    },
    dispose() {
      for (const job of jobs.values()) remove(job)
      if (listening) {
        browser.tabs.onRemoved.removeListener(removed)
        browser.tabs.onUpdated.removeListener(updated)
        listening = false
      }
    },
  }
}

const service = createNativePasteReviewService(Browser)
export const openNativePasteReview = (message, sender) => service.open(message, sender)
export const authenticateNativePasteReview = (message, sender) =>
  service.authenticate(message, sender)
export const closeNativePasteReview = (message, sender) => service.close(message, sender)
