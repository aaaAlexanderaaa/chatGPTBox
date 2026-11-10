/* eslint-env node */
import { fileURLToPath } from 'node:url'
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
export default {
  root: projectRoot,
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  test: {
    environment: 'jsdom',
    globals: true,
    include: [fileURLToPath(new URL('./functions.test.mjs', import.meta.url))],
  },
  resolve: {
    extensions: ['.mjs', '.js', '.jsx'],
    alias: { 'webextension-polyfill': projectRoot + 'tests/__stubs__/webextension-polyfill.mjs' },
  },
}
