import type { FsEntry, Host, SyncItem } from '@shared/types'
import type { FileNode, FileStatus } from '@/ds'
import { compileExcludes, type ExcludeFn } from '@shared/exclude'
import { formatBytes } from '@shared/format'
import { relativeTo } from '@shared/paths'
import { counterpart, type PaneChip, type PaneState, type Side } from '../../stores/browser'

export interface TreeInput {
  side: Side
  pane: PaneState
  other: PaneState
  localRoot: string
  remoteRoot: string
  host: Host | undefined
  conflicts: Set<string>
  diffOnly: boolean
}

export interface TreeResult {
  nodes: FileNode[]
  order: string[]
  counts: { changed: number; only: number }
  byPath: Map<string, FsEntry>
}

const exclCache = new WeakMap<Host, ExcludeFn>()
function excludeFn(host: Host | undefined): ExcludeFn {
  if (!host) return () => false
  let fn = exclCache.get(host)
  if (!fn) exclCache.set(host, (fn = compileExcludes(host.excluded)))
  return fn
}

export function conflictPaths(items: SyncItem[], hostId: string | undefined): Set<string> {
  const s = new Set<string>()
  for (const it of items) {
    if (it.hostId !== hostId || it.kind !== 'conflict') continue
    s.add(it.localPath)
    s.add(it.remotePath)
  }
  return s
}

function statusOf(t: TreeInput, e: FsEntry, dir: string): FileStatus | undefined {
  if (t.conflicts.has(e.path)) return 'conflict'
  const cdir = counterpart(t.side, dir, t.localRoot, t.remoteRoot)
  if (!cdir) return undefined
  const list = t.other.entries[cdir]
  if (!list) return undefined
  const twin = list.find((x) => x.name === e.name)
  if (!twin) return t.side === 'local' ? 'added' : 'untracked'
  if (e.type === 'file' && twin.type === 'file' && e.size !== twin.size) return 'modified'
  return undefined
}

function keep(chip: PaneChip, diffOnly: boolean, st: FileStatus | undefined): boolean {
  if (diffOnly && !st) return false
  if (chip === 'changed') return st === 'modified' || st === 'conflict'
  if (chip === 'only') return st === 'added' || st === 'untracked'
  return true
}

export function buildTree(t: TreeInput): TreeResult {
  const { pane } = t
  const isExcluded = excludeFn(t.host)
  const filter = pane.filter.trim().toLowerCase()
  const filtering = !!filter || pane.chip !== 'all' || t.diffOnly
  const counts = { changed: 0, only: 0 }
  const byPath = new Map<string, FsEntry>()
  const order: string[] = []
  const root = pane.root

  const build = (dir: string): FileNode[] => {
    const list = pane.entries[dir]
    if (!list) return []
    const out: FileNode[] = []
    for (const e of list) {
      byPath.set(e.path, e)
      const isDir = e.type === 'dir'
      const rel = relativeTo(root, e.path)
      const excluded = rel ? isExcluded(rel, isDir) : false
      const status = excluded ? undefined : statusOf(t, e, dir)
      if (!isDir && status) {
        if (status === 'modified' || status === 'conflict') counts.changed++
        else counts.only++
      }
      const open = isDir && !!pane.expanded[e.path]
      const children = isDir ? (open ? build(e.path) : []) : undefined
      const selfMatch = (!filter || e.name.toLowerCase().includes(filter)) && keep(pane.chip, t.diffOnly, status)
      if (filtering) {
        const hasKids = !!children && children.length > 0
        if (!selfMatch && !hasKids) continue
        // Folders only kept for their matching children when they don't match themselves.
        if (isDir && !selfMatch && !hasKids) continue
      }
      out.push({
        name: e.name,
        path: e.path,
        type: isDir ? 'folder' : 'file',
        children,
        open: open || (filtering && !!children?.length && !!pane.expanded[e.path]),
        loading: !!pane.loading[e.path],
        status,
        dim: excluded,
        badge: excluded ? 'excluded' : isDir ? undefined : formatBytes(e.size),
        title: e.type === 'symlink' ? `${e.path} (symlink)` : e.path
      })
    }
    return out
  }

  const nodes = build(root)
  const walk = (ns: FileNode[]) => {
    for (const n of ns) {
      order.push(n.path)
      if (n.open && n.children) walk(n.children)
    }
  }
  walk(nodes)
  return { nodes, order, counts, byPath }
}
