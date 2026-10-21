import { describe, expect, it } from 'vitest'
import { posixJoin, posixDirname, relativeTo, toLocalPath, toRemotePath } from './paths'
import type { Host } from './types'

const host = {
  mappings: [
    { local: '~/Projects/api', remote: '/var/www/api' },
    { local: '~/Projects/api/public/build', remote: '/var/www/cdn/build' }
  ]
} as unknown as Host

describe('paths', () => {
  it('maps using the longest mapping', () => {
    expect(toRemotePath(host, '/Users/a/Projects/api/app/x.php', '/Users/a')).toBe('/var/www/api/app/x.php')
    expect(toRemotePath(host, '/Users/a/Projects/api/public/build/app.js', '/Users/a')).toBe('/var/www/cdn/build/app.js')
    expect(toRemotePath(host, '/Users/a/Other/x', '/Users/a')).toBeNull()
    expect(toLocalPath(host, '/var/www/api', '/Users/a')).toBe('/Users/a/Projects/api')
    expect(toLocalPath(host, '/var/www/cdn/build/a.js', '/Users/a')).toBe('/Users/a/Projects/api/public/build/a.js')
  })
  it('posix helpers', () => {
    expect(posixJoin('/var/www/', '../x', 'y')).toBe('/var/x/y')
    expect(posixDirname('/a')).toBe('/')
    expect(relativeTo('C:\\p\\api', 'C:/p/api/app/x')).toBe('app/x')
  })
})
