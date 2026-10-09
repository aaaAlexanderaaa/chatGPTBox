import { normalizeChatgptWebReferenceText } from './reference-text.mjs'
import { renderGenuiTree, genuiCitationItems } from './genui-components.mjs'
import { decodeGenuiResult, createGenuiDiagnostics, recordGenuiError } from './genui-static.mjs'
import { escapeGenuiHtml, genuiSafeUrl } from './genui-presentation.mjs'

export function decodeChatgptWebGenui(dil) {
  return decodeGenuiResult(dil).tree
}

function renderGenuiFallbackMarkdown(dil, contentReferences) {
  if (typeof dil.fallbackMarkdown !== 'string') return null
  const results = dil.appData?.opGenui?.componentResults || {}
  const refs = Object.keys(results).flatMap((id) => genuiCitationItems(dil, id))
  const markdown = normalizeChatgptWebReferenceText(dil.fallbackMarkdown, contentReferences, {
    preserveUnresolvedCitations: true,
  })
  return markdown.replace(/\uE200cite\uE202([^\uE201]*)\uE201/g, (_, ids) =>
    [...new Set(ids.split('\uE202'))]
      .flatMap((id) => {
        const item = refs.find((entry) => entry.ref_id === id)
        return item
          ? [`[${escapeGenuiHtml(item.source_label || 'Source')}](${genuiSafeUrl(item.url)})`]
          : []
      })
      .join(' '),
  )
}

// Preserve the string API while exposing whether the source actually produced
// HTML, used a component fallback, or fell back to the whole Markdown answer.
export function renderChatgptWebGenuiResult(message) {
  const dil = message?.metadata?.model_dil_v2
  if (!dil) return null
  const diagnostics = createGenuiDiagnostics()
  const decoded = decodeGenuiResult(dil, diagnostics)
  let reason = decoded.reason
  try {
    if (decoded.tree != null) {
      const html = renderGenuiTree(decoded.tree, dil, diagnostics)
      return {
        text: `<div class="chatgptbox-genui">${html}</div>`,
        format: 'html',
        status: diagnostics.localFallbacks ? 'partial' : 'rendered',
        fallbackReason: null,
        ...diagnostics,
      }
    }
  } catch (error) {
    recordGenuiError(diagnostics, error)
    reason = error.reason || 'invalid-props'
  }
  const text = renderGenuiFallbackMarkdown(dil, message.metadata.content_references)
  return {
    text,
    format: text == null ? null : 'markdown',
    status: text == null ? 'unavailable' : 'fallback',
    fallbackReason: reason || 'unsupported-expression',
    ...diagnostics,
  }
}

export function renderChatgptWebGenui(message) {
  return renderChatgptWebGenuiResult(message)?.text ?? null
}
