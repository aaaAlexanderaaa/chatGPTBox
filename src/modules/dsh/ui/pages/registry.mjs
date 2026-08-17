const pages = []

export function registerPage(page) {
  if (!page || typeof page.id !== 'string' || !page.id) {
    throw new Error('dsh pages: registerPage requires an id')
  }
  if (pages.some((entry) => entry.id === page.id)) {
    throw new Error(`dsh pages: duplicate id "${page.id}"`)
  }
  pages.push(page)
}

export function listPages() {
  return [...pages]
}

export function getPage(id) {
  return pages.find((page) => page.id === id) || null
}
