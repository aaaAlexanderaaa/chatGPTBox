/* eslint-env node */
import { validateChatgptImagePointer } from '../../src/services/clients/chatgpt-web/image-content.mjs'
// Preparation may be resumed. The persisted sending boundary is never replayed.
export class ImageSendOperations {
  constructor({ ledger, attachments, dispatch }) {
    this.ledger = ledger
    this.attachments = attachments
    this.dispatch = dispatch
    this.active = new Set()
  }
  snapshot(record) {
    const phase = record.phase || (record.state === 'completed' ? 'accepted' : 'ambiguous')
    const interrupted =
      ['preparing', 'uploading'].includes(phase) && !this.active.has(record.operationId)
    const uncertain = phase === 'sending' && !this.active.has(record.operationId)
    return {
      operationId: record.operationId,
      phase: interrupted ? 'interrupted' : uncertain ? 'ambiguous' : phase,
      dispatched: record.dispatched !== false,
      uploadedCount: record.imagePointers?.length || 0,
      attachmentCount: record.attachmentIds?.length || 0,
      pending: ['preparing', 'uploading', 'sending'].includes(phase) && !interrupted && !uncertain,
      retryable: record.dispatched === false && !this.active.has(record.operationId),
      result: record.state === 'completed' ? record.result : null,
      error: record.error || null,
      updatedAt: record.updatedAt,
    }
  }
  start(record, payload, action) {
    if (this.active.has(record.operationId) || record.state === 'completed') return
    if (record.phase && record.dispatched !== false) return
    this.ledger.update(record, {
      phase: 'preparing',
      dispatched: false,
      attachmentIds: payload.attachmentIds || [],
      error: null,
    })
    this.active.add(record.operationId)
    void this.run(record, payload, action).finally(() => this.active.delete(record.operationId))
  }
  async run(record, payload, action) {
    try {
      const images = this.attachments.resolve(payload.attachmentIds || [])
      const pointers = [...(record.imagePointers || [])]
      pointers.forEach(validateChatgptImagePointer)
      this.ledger.update(record, { phase: 'uploading', dispatched: false })
      for (let index = pointers.length; index < images.length; index++) {
        const uploaded = await this.dispatch(
          'chatgpt_web_upload_images',
          {
            images: [images[index]],
            projectId: payload.projectId,
          },
          190000,
        )
        if (
          !Array.isArray(uploaded) ||
          uploaded.length !== 1 ||
          uploaded[0].attachmentId !== images[index].id
        )
          throw new Error('ChatGPT image upload returned no matching attachment')
        validateChatgptImagePointer(uploaded[0])
        pointers.push(uploaded[0])
        this.ledger.update(record, { imagePointers: pointers })
      }
      // Persist BEFORE forwarding the only message write. A crash or missing
      // acknowledgement after this point is ambiguous even when GET sees no turn.
      this.ledger.update(record, { phase: 'sending', dispatched: true })
      const result = await this.dispatch(
        action,
        {
          query: payload.query,
          conversationId: payload.conversationId,
          model: payload.model,
          thinkingEffort: payload.thinkingEffort,
          think: payload.think,
          projectId: payload.projectId,
          images: pointers,
          operationId: record.operationId,
        },
        60000,
      )
      if (result?.dispatched === false) {
        this.ledger.update(record, {
          phase: 'failed',
          dispatched: false,
          error: result.error || 'Message was not submitted',
        })
        return
      }
      if (!result?.conversationId || !result.messageId)
        throw new Error('ChatGPT returned no message acknowledgement')
      this.ledger.complete(record, {
        ...result,
        query: payload.query,
        projectId: payload.projectId || null,
        attachments: payload.attachmentIds || [],
        images: pointers,
      })
      this.ledger.update(record, { phase: 'accepted', dispatched: true })
    } catch (error) {
      try {
        if (record.dispatched === false)
          this.ledger.update(record, { phase: 'failed', error: error.message })
        else {
          this.ledger.ambiguous(record, error)
          this.ledger.update(record, { phase: 'ambiguous', dispatched: true })
        }
      } catch {
        /* A failed ledger write must never trigger a second dispatch. */
      }
    }
  }
}
