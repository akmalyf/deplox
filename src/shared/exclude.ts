/**
 * gitignore-style subset:
 *  - `*` any chars except `/`, `**` any depth, `?` one char
 *  - leading `/` anchors to the root; otherwise the pattern matches at any depth
 *  - a pattern containing a `/` in the middle is anchored (like gitignore)
 *  - trailing `/` matches directories only
 *  - a matched directory excludes everything below it
 *  - `#` comments and blank lines ignored; `!` negation unsupported (ignored)
 */
export type ExcludeFn = (relPath: string, isDir: boolean) => boolean

interface Rule {
  re: RegExp
  dirOnly: boolean
}

function escape(ch: string): string {
  return /[.+^${}()|[\]\\]/.test(ch) ? '\\' + ch : ch
}

function globToRegex(glob: string): string {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` → zero or more directories, `/**` → everything below, bare `**` → anything
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else out += '[^/]*'
    } else if (c === '?') out += '[^/]'
    else out += escape(c)
  }
  return out
}

export function compileExcludes(patterns: string[]): ExcludeFn {
  const rules: Rule[] = []
  for (const raw of patterns) {
    let p = raw.trim()
    if (!p || p.startsWith('#') || p.startsWith('!')) continue
    const dirOnly = p.endsWith('/')
    if (dirOnly) p = p.replace(/\/+$/, '')
    const anchored = p.startsWith('/') || p.slice(0, -1).includes('/')
    p = p.replace(/^\/+/, '')
    if (!p) continue
    const body = globToRegex(p)
    rules.push({ re: new RegExp((anchored ? '^' : '^(?:.*/)?') + body + '$'), dirOnly })
  }
  if (!rules.length) return () => false

  return (relPath: string, isDir: boolean): boolean => {
    const rel = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (!rel) return false
    const segs = rel.split('/')
    // Check every ancestor (as a directory) and the path itself.
    for (let i = 1; i <= segs.length; i++) {
      const sub = segs.slice(0, i).join('/')
      const subIsDir = i < segs.length || isDir
      for (const r of rules) {
        if (r.dirOnly && !subIsDir) continue
        if (r.re.test(sub)) return true
      }
    }
    return false
  }
}
