// A persistent Drafts iCloud boundary shared across separate action invocations.
export function createDraftsFileManager(preferences = {}) {
  const files = new Map()
  const directories = new Set(['/'])
  if (preferences) {
    directories.add('/ChatGPTBox')
    files.set(
      '/ChatGPTBox/settings.json',
      JSON.stringify({
        version: 1,
        baseUrl: null,
        modelOverride: null,
        includeThinking: false,
        ...preferences,
      }),
    )
  }
  const cloud = {
    exists: (path) => files.has(path) || directories.has(path),
    readString: (path) => files.get(path),
    createDirectory(name, path) {
      directories.add(path.replace(/\/$/, '') + '/' + name)
      return true
    },
    writeJSON(path, value) {
      files.set(path, JSON.stringify(value))
      return true
    },
    writeString(path, value) {
      files.set(path, value)
      return true
    },
    moveItem(from, to, overwrite) {
      if (!files.has(from) || (files.has(to) && !overwrite)) return false
      files.set(to, files.get(from))
      files.delete(from)
      return true
    },
  }
  return { files, createCloud: () => cloud }
}
