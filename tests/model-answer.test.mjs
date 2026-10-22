import { describe, expect, it } from 'vitest'
import { normalizeModelAnswer, unwrapAnswerFence } from '../src/services/model-answer.mjs'
import { parseReadingResult } from '../src/browser-assistant/functions.mjs'

const guide = {
  guide: 'Overview',
  annotations: [{ ref: 'b1', quote: 'A {quoted} passage', reason: 'Evidence' }],
}
const json = JSON.stringify(guide)

describe('model answer boundaries', () => {
  it.each([
    json,
    `<think>We need to inspect the evidence.</think>${json}`,
    `<THINK>First thought.</THINK>\n<analysis>Another thought.</analysis>\n${json}`,
    `<think>${JSON.stringify({ ...guide, guide: 'An example, not the answer' })}</think>\n${json}`,
    `<think>We need an answer.</think>\nHere is the guide:\n\n\`\`\`json\n${json}\n\`\`\`\nI used the provided source.`,
    `We need to inspect this.\n</think>\n${json}`,
    `Here is the requested guide: ${json}\nDone.`,
    `\uFEFF\`\`\`json\n${json}\n\`\`\``,
  ])('reads the final guide through normal model wrappers', (text) => {
    expect(parseReadingResult(text)).toEqual(guide)
  })
  it('does not mistake reasoning-only output for a final answer', () => {
    const answer = normalizeModelAnswer(`<think>Possible JSON: ${json}`)
    expect(answer.pending).toBe(true)
    expect(answer.text).toBe('')
    expect(() => parseReadingResult(`<think>${json}`)).toThrow('not a valid reading guide')
  })
  it('preserves literal reasoning tags and escaped braces inside a JSON string', () => {
    const value = { guide: 'Literal <think> and </think>, "}" and \\ delimiters', annotations: [] }
    expect(parseReadingResult(`Explanation:\n${JSON.stringify(value)}\nEnd.`)).toEqual(value)
  })
  it('rejects conflicting valid documents instead of guessing the intended guide', () => {
    expect(() =>
      parseReadingResult(`${json}\n${JSON.stringify({ ...guide, guide: 'Different' })}`),
    ).toThrow('multiple reading guides')
  })
  it.each(['A normal prose answer.', '{"guide":', '<think>Thoughts</think>normal answer'])(
    'reports a friendly fallback, never a JSON implementation error',
    (text) => {
      try {
        parseReadingResult(text)
        throw new Error('Expected failure')
      } catch (error) {
        expect(error).not.toBeInstanceOf(SyntaxError)
        expect(error.message).toContain('original answer is preserved')
      }
    },
  )
  it('unwraps rewrite fences after removing reasoning', () => {
    const answer = normalizeModelAnswer(
      '<think>Editing rationale</think>\n```text\nBetter draft\n```',
    )
    expect(answer.reasoning).toBe('Editing rationale')
    expect(unwrapAnswerFence(answer.text)).toBe('Better draft')
  })
})
