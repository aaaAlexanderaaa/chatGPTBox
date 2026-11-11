// Shared data model for conversation rendering.
//
// Extracted from ConversationCard/index.jsx so both the render-only component
// and the useConversationRuntime hook can reference the same item shape
// without a circular import. An "item" is one row in the conversation body:
// a user question, an assistant answer (streaming or done), or an error.
export class ConversationItemData extends Object {
  /**
   * @param {'question'|'answer'|'error'} type
   * @param {string} content
   * @param {boolean} done
   * @param {boolean} placeholder An owned loading placeholder, never provider content.
   */
  constructor(type, content, done = false, placeholder = false) {
    super()
    this.type = type
    this.content = content
    this.done = done
    if (placeholder) this.placeholder = true
  }
}
