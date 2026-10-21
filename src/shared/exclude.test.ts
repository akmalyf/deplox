import { describe, expect, it } from 'vitest'
import { compileExcludes } from './exclude'

describe('compileExcludes', () => {
  const ex = compileExcludes(['.env', 'storage/logs', 'vendor', 'node_modules/', '*.log', '/build', 'docs/**/draft.md'])
  it('matches names at any depth', () => {
    expect(ex('.env', false)).toBe(true)
    expect(ex('config/.env', false)).toBe(true)
    expect(ex('vendor/autoload.php', false)).toBe(true)
    expect(ex('pkg/node_modules/x/index.js', false)).toBe(true)
    expect(ex('a/b/error.log', false)).toBe(true)
  })
  it('anchors patterns with slashes', () => {
    expect(ex('storage/logs/laravel.log', false)).toBe(true)
    expect(ex('storage/logs', true)).toBe(true)
    expect(ex('app/storage/logs/x', false)).toBe(false)
    expect(ex('build/x.js', false)).toBe(true)
    expect(ex('src/build/x.js', false)).toBe(false)
  })
  it('dir-only and globstar', () => {
    expect(ex('node_modules', false)).toBe(false)
    expect(ex('docs/a/b/draft.md', false)).toBe(true)
    expect(ex('docs/draft.md', false)).toBe(true)
    expect(ex('app/Http/Kernel.php', false)).toBe(false)
  })
})
