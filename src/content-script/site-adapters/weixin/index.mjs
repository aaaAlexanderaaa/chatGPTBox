import { cropText } from '../../../utils'
import { safeAdapter } from '../_helpers.mjs'

export default {
  inputQuery: safeAdapter('weixin.inputQuery', async () => {
    const title = document.querySelector('#activity-name')?.textContent
    const description = document.querySelector('#js_content')?.textContent
    if (title && description) {
      const author = document.querySelector('#js_name')?.textContent

      const sidebar = document.querySelector('.qr_code_pc')
      if (sidebar) {
        sidebar.style.right = '-400px'
        sidebar.style.width = '400px'
        sidebar.style.textAlign = 'left'
        sidebar.style.alignItems = 'center'
        sidebar.style.display = 'flex'
        sidebar.style.flexDirection = 'column'
        sidebar.style.background = 'transparent'
      }

      return await cropText(
        `You are an expert article analyst and summarizer. ` +
          `Please analyze the following WeChat Official Account article. Provide the source, a summary of the article, its main conclusions, and your opinion on it.\n` +
          `Article Title: "${title}"\n` +
          `Source: "${author} Official Account"\n` +
          `Content:\n"${description}"`,
      )
    }
  }),
}
