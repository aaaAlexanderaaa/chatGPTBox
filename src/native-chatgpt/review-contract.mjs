export const PASTE_REVIEW_PORT = 'chatgptbox-native-paste-review'
export const PASTE_REVIEW_TTL_MS = 5 * 60 * 1000
export const PasteReviewAction = Object.freeze({
  Authenticate: 'authenticate',
  Review: 'review',
  Apply: 'apply',
  Cancel: 'cancel',
  Finished: 'finished',
})
export const isPasteJobId = (value) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)

export function trustedReviewPort(sender, expected, extensionId) {
  return !!(
    sender &&
    expected &&
    sender.id === extensionId &&
    // tabs.connect omits source metadata in some supported Chromium versions.
    // The background-authenticated one-use proof is mandatory in the handshake.
    (sender.tab === undefined || sender.tab.id === expected.reviewTabId) &&
    (sender.url === undefined || sender.url === expected.reviewUrl)
  )
}
