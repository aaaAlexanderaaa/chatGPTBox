// Acquisition is shared by page functions and the GitHub summary adapter.
// Only already-loaded visible discussion bodies are included; draft inputs stay out.
export function readingRoots(doc) {
  const url = new URL(doc.location.href)
  if (
    url.hostname === 'github.com' &&
    /^\/[^/]+\/[^/]+\/(issues|pull)\/\d+(?:\/|$)/.test(url.pathname)
  ) {
    const excluded = 'form, .js-preview-body, [data-testid="markdown-preview"], .preview-content'
    const bodies = [
      ...doc.querySelectorAll(
        '.comment-body, [data-testid="issue-body-viewer"] [data-testid="markdown-body"], [data-testid^="comment-viewer-outer-box-"] [data-testid="markdown-body"]',
      ),
    ]
      .filter((element) => !element.closest(excluded))
      .filter(
        (element, index, list) => !list.some((other, i) => i !== index && other.contains(element)),
      )
    if (bodies.length) return { roots: bodies, source: 'GitHub loaded discussion', excluded }
    return {
      roots: [doc.querySelector('main, [role="main"]') || doc.body],
      source: 'GitHub loaded discussion',
      excluded,
    }
  }
  // Prefer the whole main area, including sibling articles, over the first teaser.
  const mains = [...doc.querySelectorAll('main, [role="main"]')]
  const articles = [...doc.querySelectorAll('article')]
  const roots = mains.length ? mains : articles.length ? articles : [doc.body]
  return {
    roots: roots.filter(
      (root, index) => !roots.some((other, i) => i !== index && other.contains(root)),
    ),
    source: 'Page text',
  }
}
