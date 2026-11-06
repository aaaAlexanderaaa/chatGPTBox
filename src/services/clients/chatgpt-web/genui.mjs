import { normalizeChatgptWebReferenceText } from './reference-text.mjs'
import { renderGenuiTree, genuiCitationItems } from './genui-components.mjs'
import { decodeGenuiResult, createGenuiDiagnostics, recordGenuiError } from './genui-static.mjs'
import { escapeGenuiHtml, genuiSafeUrl } from './genui-presentation.mjs'
import { genuiClientWidgetTree } from './genui-client-widgets.mjs'

export function decodeChatgptWebGenui(dil) {
  return decodeGenuiResult(dil).tree
}

function replaceReferencedWidgets(source, contentReferences, diagnostics) {
  let text = source,
    converted = 0
  const replacements = []
  if (source.length > 500000 || contentReferences?.length > 512)
    return { text, converted, replacements }
  let renderedBytes = 0
  let scanned = 0
  const references = (Array.isArray(contentReferences) ? contentReferences : [])
    .filter(
      (reference) =>
        reference?.type === 'client_defined_widget' &&
        typeof reference.matched_text === 'string' &&
        reference.matched_text,
    )
    .sort((a, b) => (b.start_idx ?? -1) - (a.start_idx ?? -1))
  for (const reference of references) {
    // Existing Markdown code fences already provide the complete static view.
    if (reference.data?.widget_type === 'code_block' || reference.category === 'code_block')
      continue
    scanned += text.length
    if (scanned > 4000000) break
    const matched = reference.matched_text
    let start = reference.start_idx,
      end = reference.end_idx
    if (!Number.isInteger(start) || !Number.isInteger(end) || text.slice(start, end) !== matched) {
      const characters = Array.from(text)
      if (
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        characters.slice(start, end).join('') === matched
      ) {
        start = characters.slice(0, start).join('').length
        end = start + matched.length
      } else {
        start = text.indexOf(matched)
        if (start < 0 || start !== text.lastIndexOf(matched)) continue
        end = start + matched.length
      }
    }
    try {
      const tree = genuiClientWidgetTree(reference, diagnostics)
      const html = renderGenuiTree(tree, {}, diagnostics)
      if (source.length + renderedBytes + html.length > 1000000) continue
      // Citation cleanup operates on the original Markdown, never on code,
      // chart labels or source text inside already-escaped widget HTML.
      const marker = `\u0000${crypto.randomUUID()}\u0000`
      replacements.push([marker, `\n\n<div class="chatgptbox-genui">${html}</div>\n\n`])
      text = text.slice(0, start) + marker + text.slice(end)
      renderedBytes += html.length
      converted += 1
    } catch {
      // Unmatched, unresolved or oversized content retains its original text.
    }
  }
  return { text, converted, replacements }
}

function restoreReferencedWidgets(text, result) {
  for (const [marker, html] of result.replacements) text = text.replace(marker, () => html)
  return text
}

export function renderChatgptWebReferencedWidgets(source, contentReferences) {
  if (typeof source !== 'string') return null
  const diagnostics = createGenuiDiagnostics()
  const result = replaceReferencedWidgets(source, contentReferences, diagnostics)
  if (!result.converted) return null
  return {
    text: restoreReferencedWidgets(
      normalizeChatgptWebReferenceText(result.text, contentReferences),
      result,
    ),
    format: 'html',
    status: diagnostics.localFallbacks ? 'partial' : 'rendered',
    fallbackReason: null,
    ...diagnostics,
  }
}

function renderGenuiFallbackMarkdown(dil, contentReferences, diagnostics) {
  if (typeof dil.fallbackMarkdown !== 'string') return null
  const results = dil.appData?.opGenui?.componentResults || {}
  const refs = Object.keys(results).flatMap((id) => genuiCitationItems(dil, id))
  const replaced = replaceReferencedWidgets(dil.fallbackMarkdown, contentReferences, diagnostics)
  const markdown = normalizeChatgptWebReferenceText(replaced.text, contentReferences, {
    preserveUnresolvedCitations: true,
  })
  return restoreReferencedWidgets(
    markdown.replace(/\uE200cite\uE202([^\uE201]*)\uE201/g, (_, ids) =>
      [...new Set(ids.split('\uE202'))]
        .flatMap((id) => {
          const item = refs.find((entry) => entry.ref_id === id)
          return item
            ? [`[${escapeGenuiHtml(item.source_label || 'Source')}](${genuiSafeUrl(item.url)})`]
            : []
        })
        .join(' '),
    ),
    replaced,
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
      const html = renderGenuiTree(decoded.tree, dil, diagnostics, {
        contentReferences: message.metadata.content_references,
      })
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
  const text = renderGenuiFallbackMarkdown(dil, message.metadata.content_references, diagnostics)
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
