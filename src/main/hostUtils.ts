import { compileExcludes, type ExcludeFn } from '@shared/exclude'
import { expandHome, findMappingForLocal, findMappingForRemote, normLocal, posixNormalize, relativeTo } from '@shared/paths'
import type { StoredHost } from './store/schema'
import type { Host } from '@shared/types'

const cache = new WeakMap<object, ExcludeFn>()

function fnFor(host: StoredHost): ExcludeFn {
  let fn = cache.get(host)
  if (!fn) {
    fn = compileExcludes(host.excluded)
    cache.set(host, fn)
  }
  return fn
}

/** Exclude check on absolute local paths, relative to the matching mapping. */
export function isExcludedLocal(host: StoredHost, abs: string, isDir: boolean, home: string): boolean {
  const m = findMappingForLocal(host as Host, abs, home)
  if (!m) return false
  const rel = relativeTo(m.local, abs)
  return rel ? fnFor(host)(rel, isDir) : false
}

export function isExcludedRemote(host: StoredHost, abs: string, isDir: boolean, home: string): boolean {
  const m = findMappingForRemote(host as Host, abs, home)
  if (!m) return false
  const rel = relativeTo(m.remote, posixNormalize(abs))
  return rel ? fnFor(host)(rel, isDir) : false
}

export function localRoots(host: StoredHost, home: string): string[] {
  return host.mappings.map((m) => normLocal(expandHome(m.local, home)))
}

export function concurrencyOf(host: StoredHost, fallback: number): number {
  if (host.concurrency && host.concurrency > 0) return host.concurrency
  return host.protocol === 'sftp' ? fallback : 2
}
