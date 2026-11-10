import Browser from 'webextension-polyfill'

// Keep an old component's pending write before the next component's read/flush
// within this live extension context. Separate windows do not merge drafts.
const writes = new Map()
function enqueue(key, write) {
  const previous = writes.get(key)
  let run
  try {
    run = previous ? previous.then(write) : Promise.resolve(write())
  } catch (error) {
    run = Promise.reject(error)
  }
  const tail = run.catch(() => {})
  writes.set(key, tail)
  void tail.then(() => {
    if (writes.get(key) === tail) writes.delete(key)
  })
  return run
}
export async function readInputDraft(key) {
  await writes.get(key)
  const stored = await Browser.storage.local.get(key)
  return typeof stored?.[key] === 'string' ? stored[key] : ''
}
export const writeInputDraft = (key, value) =>
  enqueue(key, () => Browser.storage.local.set({ [key]: value }))
export const removeInputDraft = (key) => enqueue(key, () => Browser.storage.local.remove(key))
