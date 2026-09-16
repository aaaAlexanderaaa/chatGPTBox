/* eslint-env node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relative) {
  return readFileSync(path.join(root, relative), 'utf8')
}

describe('production bundle sharing invariants', () => {
  it('puts the UI kit in the shared webpack entry for every build', () => {
    const build = read('build.mjs')
    expect(build).toMatch(/'\.\/src\/components'/)
    expect(build).not.toMatch(
      /if\s*\(\s*isWithoutKatex\s*\)\s*shared\.push\('\.\/src\/components'\)/,
    )
  })

  it('packages shared.css next to shared.js', () => {
    const build = read('build.mjs')
    expect(build).toMatch(/src:\s*'build\/shared\.css',\s*dst:\s*'shared\.css'/)
  })

  it('keeps KaTeX woff2 inlined for content-script CSS', () => {
    const build = read('build.mjs')
    expect(build).toMatch(/test:\s*\/\\?\.woff2\$\/,\s*type:\s*'asset\/inline'/)
  })

  it('pins lowlight to the common language set', () => {
    const build = read('build.mjs')
    expect(build).toMatch(
      /(['"])lowlight\$\1:\s*path\.resolve\(__dirname,\s*'node_modules\/lowlight\/lib\/common\.js'\)/,
    )
  })

  it('injects shared.css in both manifests before content-script.css', () => {
    for (const relative of ['src/manifest.json', 'src/manifest.v2.json']) {
      const manifest = JSON.parse(read(relative))
      const css = manifest.content_scripts[0].css
      expect(css).toContain('shared.css')
      expect(css).toContain('content-script.css')
      expect(css.indexOf('shared.css')).toBeLessThan(css.indexOf('content-script.css'))
    }
  })

  it('proxy fallback injectors insert shared.css before content-script.css', () => {
    for (const relative of [
      'src/background/chatgpt-proxy-service.mjs',
      'src/background/grok-proxy-service.mjs',
    ]) {
      expect(read(relative)).toMatch(
        /files:\s*\[['"]shared\.css['"],\s*['"]content-script\.css['"]\]/,
      )
    }
  })

  it('does not re-export crop-text from the utils barrel', () => {
    const barrel = read('src/utils/index.mjs')
    expect(barrel).not.toMatch(/from ['"]\.\/crop-text['"]/)
    expect(read('src/content-script/index.jsx')).toMatch(/from ['"]\.\.\/utils\/crop-text\.mjs['"]/)
  })
})
