/* global HTTP, Prompt, app, draft */
const BASE_URL = 'http://127.0.0.1:18080'
const API_TOKEN = 'PASTE_GATEWAY_API_TOKEN_HERE'
const PHOTO_METADATA_RE = /<!-- chatgptbox-photos:(\{.*\}) -->/
try {
  if (
    /<!-- chatgptbox-(?:waiting-reply:start|photo-operation:|new-operation:)/.test(
      draft.content || '',
    )
  )
    throw new Error(
      'Choose a Project on a new draft before its first send. An existing conversation keeps its current Project.',
    )
  const projects = [{ id: null, name: '不使用 Project' }]
  let cursor,
    pages = 0
  const seen = new Set()
  do {
    const response = HTTP.create().request({
      url: BASE_URL + '/chatgpt/projects' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
      method: 'GET',
      headers: { Authorization: 'Bearer ' + API_TOKEN },
    })
    if (!response.success || response.statusCode >= 400)
      throw new Error(
        response.responseData?.error?.message || response.error || 'Could not read Projects',
      )
    for (const project of response.responseData.projects || []) {
      if (!seen.has(project.id)) {
        seen.add(project.id)
        projects.push(project)
      }
    }
    cursor = response.responseData.cursor
    pages++
  } while (cursor && pages < 10)
  if (cursor)
    throw new Error('Project list is too large. Select a Project by its ID in the API request.')
  const match = (draft.content || '').match(PHOTO_METADATA_RE)
  const metadata = match ? JSON.parse(match[1]) : { images: [], pendingPhotos: [] }
  const selected = Math.max(
    0,
    projects.findIndex((project) => project.id === metadata.projectId),
  )
  const prompt = Prompt.create()
  prompt.title = '选择 ChatGPT Project'
  prompt.addPicker('project', 'Project', [projects.map((project) => project.name)], [selected])
  prompt.addButton('保存')
  if (prompt.show()) {
    const project = projects[prompt.fieldValues.project[0]]
    metadata.projectId = project.id
    metadata.projectName = project.name
    const marker = '<!-- chatgptbox-photos:' + JSON.stringify(metadata) + ' -->'
    draft.content = match
      ? draft.content.replace(PHOTO_METADATA_RE, () => marker)
      : (draft.content || '').trimEnd() + '\n\n' + marker + '\n'
    draft.update()
    app.displaySuccessMessage('Project: ' + project.name)
  }
} catch (error) {
  app.displayErrorMessage(error.message || String(error))
  throw error
}
