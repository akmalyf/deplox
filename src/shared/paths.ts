import type { Host, Mapping } from './types'

/** Normalize a local path for comparisons: forward slashes, no trailing slash (except root). */
export function normLocal(p: string): string {
  let s = p.replace(/\\/g, '/')
  if (s.length > 1 && s.endsWith('/') && !/^[A-Za-z]:\/$/.test(s)) s = s.replace(/\/+$/, '')
  return s
}

export function expandHome(p: string, home: string): string {
  if (p === '~') return home
  if (p.startsWith('~/') || p.startsWith('~\\')) return normLocal(home) + '/' + p.slice(2)
  return p
}

export function posixJoin(...parts: string[]): string {
  const joined = parts.filter((x) => x !== '').join('/')
  return posixNormalize(joined)
}

export function posixNormalize(p: string): string {
  const abs = p.startsWith('/')
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.')
}

export function posixDirname(p: string): string {
  const n = posixNormalize(p)
  if (n === '/') return '/'
  const i = n.lastIndexOf('/')
  if (i < 0) return '.'
  return i === 0 ? '/' : n.slice(0, i)
}

export function basename(p: string): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return s.slice(s.lastIndexOf('/') + 1)
}

/** True when `child` equals `parent` or lies inside it (both normalized with forward slashes). */
export function isInside(parent: string, child: string): boolean {
  const a = normLocal(parent)
  const b = normLocal(child)
  if (a === b) return true
  return b.startsWith(a.endsWith('/') ? a : a + '/')
}

/** Relative POSIX path of `p` inside `root`, '' for root itself, null when outside. */
export function relativeTo(root: string, p: string): string | null {
  const a = normLocal(root)
  const b = normLocal(p)
  if (a === b) return ''
  const prefix = a.endsWith('/') ? a : a + '/'
  return b.startsWith(prefix) ? b.slice(prefix.length) : null
}

function expanded(m: Mapping, home: string): Mapping {
  return { local: normLocal(expandHome(m.local, home)), remote: posixNormalize(m.remote) }
}

/** Longest mapping whose local root contains `localPath`. */
export function findMappingForLocal(host: Host, localPath: string, home: string): Mapping | null {
  let best: Mapping | null = null
  for (const raw of host.mappings) {
    const m = expanded(raw, home)
    if (isInside(m.local, localPath) && (!best || m.local.length > best.local.length)) best = m
  }
  return best
}

/** Longest mapping whose remote root contains `remotePath`. */
export function findMappingForRemote(host: Host, remotePath: string, home: string): Mapping | null {
  let best: Mapping | null = null
  const r = posixNormalize(remotePath)
  for (const raw of host.mappings) {
    const m = expanded(raw, home)
    const inside = r === m.remote || r.startsWith(m.remote === '/' ? '/' : m.remote + '/')
    if (inside && (!best || m.remote.length > best.remote.length)) best = m
  }
  return best
}

export function toRemotePath(host: Host, localPath: string, home: string): string | null {
  const m = findMappingForLocal(host, localPath, home)
  if (!m) return null
  const rel = relativeTo(m.local, localPath)
  return rel === null ? null : posixJoin(m.remote, rel)
}

/** Returns a forward-slash local path; callers on Windows may normalize it. */
export function toLocalPath(host: Host, remotePath: string, home: string): string | null {
  const m = findMappingForRemote(host, remotePath, home)
  if (!m) return null
  const r = posixNormalize(remotePath)
  const rel = r === m.remote ? '' : r.slice((m.remote === '/' ? 0 : m.remote.length) + 1)
  return rel ? m.local + '/' + rel : m.local
}

/** The primary (first) mapping, expanded. */
export function primaryMapping(host: Host, home: string): Mapping | null {
  return host.mappings[0] ? expanded(host.mappings[0], home) : null
}
