/* eslint-env node */
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{mjs,js,jsx}'],
    globals: false,
  },
  resolve: {
    extensions: ['.mjs', '.js', '.jsx'],
    alias: {
      'webextension-polyfill': path.resolve(
        process.cwd(),
        'tests/__stubs__/webextension-polyfill.mjs',
      ),
    },
  },
})
