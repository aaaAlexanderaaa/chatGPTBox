/* eslint-env node */
import { describe, expect, it, vi } from 'vitest'
import { OperationLedger } from '../scripts/lib/operation-ledger.mjs'
import { ImageSendOperations } from '../scripts/lib/image-send-operations.mjs'
const images = [{ id: 'image-1' }, { id: 'image-2' }]
const payload = {
  query: 'Analyze lunch',
  attachmentIds: ['image-1', 'image-2'],
  projectId: 'project-1',
}
const receipt = { conversationId: 'conversation-1', messageId: 'message-1' }
const pointer = { asset_pointer: 'file-service://file-1', size_bytes: 1, width: 1, height: 1 }
function setup(dispatch) {
  const ledger = new OperationLedger()
  const record = ledger.begin({ key: 'drafts-photo-1', fingerprint: 'same-image-and-text' }).record
  const dependencies = { ledger, attachments: { resolve: () => images }, dispatch }
  return { ledger, record, dependencies, manager: new ImageSendOperations(dependencies) }
}
const finished = async (manager, record) =>
  vi.waitFor(() => expect(manager.active.has(record.operationId)).toBe(false))
describe('photo send preparation and commit boundary', () => {
  it('uploads all images before one message write and deduplicates repeated Send clicks', async () => {
    const dispatch = vi.fn(async (action, data) =>
      action === 'chatgpt_web_upload_images'
        ? [{ ...pointer, attachmentId: data.images[0].id }]
        : receipt,
    )
    const { record, manager } = setup(dispatch)
    manager.start(record, payload, 'chatgpt_web_create_conversation')
    manager.start(record, payload, 'chatgpt_web_create_conversation')
    await finished(manager, record)
    manager.start(record, payload, 'chatgpt_web_create_conversation')
    expect(dispatch.mock.calls.map((call) => call[0])).toEqual([
      'chatgpt_web_upload_images',
      'chatgpt_web_upload_images',
      'chatgpt_web_create_conversation',
    ])
    expect(manager.snapshot(record)).toMatchObject({
      phase: 'accepted',
      dispatched: true,
      uploadedCount: 2,
      result: receipt,
    })
  })
  it('resumes preparation after an upload failure without uploading confirmed photos again', async () => {
    let failed = false
    const dispatch = vi.fn(async (action, data) => {
      if (action !== 'chatgpt_web_upload_images') return receipt
      if (data.images[0].id === 'image-2' && !failed) {
        failed = true
        throw new Error('Upload disconnected')
      }
      return [{ ...pointer, attachmentId: data.images[0].id }]
    })
    const { record, manager } = setup(dispatch)
    manager.start(record, payload, 'chatgpt_web_create_conversation')
    await finished(manager, record)
    expect(manager.snapshot(record)).toMatchObject({
      phase: 'failed',
      dispatched: false,
      uploadedCount: 1,
      retryable: true,
    })
    manager.start(record, payload, 'chatgpt_web_create_conversation')
    await finished(manager, record)
    expect(
      dispatch.mock.calls.filter((call) => call[1].images?.[0]?.id === 'image-1'),
    ).toHaveLength(1)
    expect(record.phase).toBe('accepted')
  })
  it('never replays a message when its acknowledgement was lost, including after restart', async () => {
    const dispatch = vi.fn(async (action, data) => {
      if (action === 'chatgpt_web_upload_images')
        return [{ ...pointer, attachmentId: data.images[0].id }]
      throw new Error('Acknowledgement lost')
    })
    const { record, manager, dependencies } = setup(dispatch)
    manager.start(record, payload, 'chatgpt_web_create_conversation')
    await finished(manager, record)
    expect(manager.snapshot(record)).toMatchObject({
      phase: 'ambiguous',
      retryable: false,
      dispatched: true,
    })
    new ImageSendOperations(dependencies).start(record, payload, 'chatgpt_web_create_conversation')
    expect(
      dispatch.mock.calls.filter((call) => call[0] === 'chatgpt_web_create_conversation'),
    ).toHaveLength(1)
  })
  it('recovers a checkpoint before dispatch after restart, but treats a sending checkpoint as uncertain', async () => {
    const dispatch = vi.fn(async () => receipt)
    const { record, dependencies } = setup(dispatch)
    Object.assign(record, {
      phase: 'uploading',
      dispatched: false,
      imagePointers: [
        { ...pointer, attachmentId: 'image-1' },
        { ...pointer, attachmentId: 'image-2' },
      ],
    })
    const restarted = new ImageSendOperations(dependencies)
    expect(restarted.snapshot(record).phase).toBe('interrupted')
    restarted.start(record, payload, 'chatgpt_web_create_conversation')
    await finished(restarted, record)
    expect(dispatch).toHaveBeenCalledTimes(1)
    Object.assign(record, { state: 'dispatching', phase: 'sending', dispatched: true })
    new ImageSendOperations(dependencies).start(record, payload, 'chatgpt_web_create_conversation')
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
