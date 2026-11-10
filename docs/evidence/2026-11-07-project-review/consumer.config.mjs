/* eslint-env node */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
export default {
  root: projectRoot,
  cacheDir: path.join(os.tmpdir(), 'chatgptbox-review-consumer-cache'),
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  test: {
    environment: 'jsdom',
    include: [fileURLToPath(new URL('./consumer.test.jsx', import.meta.url))],
  },
  resolve: {
    extensions: ['.mjs', '.js', '.jsx'],
    alias: { 'webextension-polyfill': projectRoot + 'tests/__stubs__/webextension-polyfill.mjs' },
  },
}
