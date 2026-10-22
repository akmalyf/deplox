import { create } from 'zustand'
import type { FsEntry } from '@shared/types'
import { normLocal, posixJoin, relativeTo } from '@shared/paths'
import { invoke, errorText } from '../lib/ipc'

export type Side = 'local' | 'remote'
export type PaneChip = 'all' | 'changed' | 'only'

export interface PaneState {
  root: string
  entries: Record<string, FsEntry[]>
  loading: Record<string, boolean>
  errors: Record<string, string>
  expanded: Record<string, boolean>
  selected: Set<string>
  anchor: string | null
  focused: string | null
  filter: string
  chip: PaneChip
  /** When the listing came from before a disconnect. */
  stale: boolean
  loadedAt: number
}

const emptyPane = (root = ''): PaneState => ({
  root,
  entries: {},
  loading: {},
  errors: {},
  expanded: { [root]: true },
  selected: new Set(),
  anchor: null,
  focused: null,
  filter: '',
  chip: 'all',
  stale: false,
  loadedAt: 0
})

interface BrowserStore {
  hostId: string | null
  local: PaneState
  remote: PaneState
  activeSide: Side
  diffOnly: boolean
  syncScroll: boolean
  transfersOpen: boolean
  transfersTab: 'transfers' | 'log'
  /** Local pane's share of the two-pane width (0..1). */
  paneSplit: number
  /** Expanded Transfers panel height in px. */
  transfersHeight: number
  setPaneSplit: (r: number) => void
  setTransfersHeight: (h: number) => void
  setHost: (hostId: string | null, localRoot: string, remoteRoot: string) => void
  setRoot: (side: Side, root: string) => void
  load: (side: Side, dir: string, quiet?: boolean) => Promise<void>
  toggle: (side: Side, dir: string, open: boolean) => void
  refresh: (side?: Side) => Promise<void>
  /** Re-list the parent directories of these paths on one side. */
  refreshPaths: (side: Side, paths: string[]) => void
  select: (side: Side, path: string, mods: { shift: boolean; meta: boolean }, order: string[]) => void
  clearSelection: (side: Side) => void
  setActiveSide: (s: Side) => void
  setFilter: (side: Side, f: string) => void
  setChip: (side: Side, c: PaneChip) => void
  setDiffOnly: (b: boolean) => void
  setSyncScroll: (b: boolean) => void
  setTransfersOpen: (b: boolean) => void
  setTransfersTab: (t: 'transfers' | 'log') => void
  markStale: (b: boolean) => void
}

function parentOf(side: Side, p: string): string {
  if (side === 'remote') {
    const i = p.lastIndexOf('/')
    return i <= 0 ? '/' : p.slice(0, i)
  }
  const s = p.replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i <= 0 ? s.slice(0, 1) || '/' : s.slice(0, i)
}

/** Counterpart path on the other side, based on the two pane roots. */
export function counterpart(from: Side, path: string, localRoot: string, remoteRoot: string): string | null {
  if (from === 'local') {
    const rel = relativeTo(localRoot, path)
    return rel === null ? null : rel ? posixJoin(remoteRoot, rel) : remoteRoot
  }
  const rel = relativeTo(remoteRoot, path)
  if (rel === null) return null
  return rel ? `${normLocal(localRoot)}/${rel}` : localRoot
}

export const DEFAULT_PANE_SPLIT = 0.5
export const DEFAULT_TRANSFERS_HEIGHT = 196
const LAYOUT_KEY = 'deplox.browser.layout'

// Pane sizes are a per-machine convenience, so browser storage is enough; it may be unavailable.
function loadLayout(): { paneSplit: number; transfersHeight: number } {
  const def = { paneSplit: DEFAULT_PANE_SPLIT, transfersHeight: DEFAULT_TRANSFERS_HEIGHT }
  try {
    const v = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null') as Partial<typeof def> | null
    return {
      paneSplit: typeof v?.paneSplit === 'number' ? v.paneSplit : def.paneSplit,
      transfersHeight: typeof v?.transfersHeight === 'number' ? v.transfersHeight : def.transfersHeight
    }
  } catch {
    return def
  }
}

function saveLayout(layout: { paneSplit: number; transfersHeight: number }): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    // Sizes just reset next launch.
  }
}

export const useBrowser = create<BrowserStore>((set, get) => ({
  hostId: null,
  local: emptyPane(),
  remote: emptyPane(),
  activeSide: 'remote',
  diffOnly: false,
  syncScroll: true,
  transfersOpen: true,
  transfersTab: 'transfers',
  ...loadLayout(),

  setHost: (hostId, localRoot, remoteRoot) => {
    const st = get()
    if (st.hostId === hostId && st.local.root === localRoot && st.remote.root === remoteRoot && st.local.loadedAt) return
    set({ hostId, local: emptyPane(localRoot), remote: emptyPane(remoteRoot) })
    if (localRoot) void get().load('local', localRoot)
    if (remoteRoot && hostId) void get().load('remote', remoteRoot)
  },

  setRoot: (side, root) => {
    set({ [side]: emptyPane(root) } as Partial<BrowserStore>)
    void get().load(side, root)
  },

  load: async (side, dir, quiet) => {
    const hostId = get().hostId
    if (side === 'remote' && !hostId) return
    if (!quiet) set((st) => ({ [side]: { ...st[side], loading: { ...st[side].loading, [dir]: true } } }) as Partial<BrowserStore>)
    try {
      const list = side === 'local' ? await invoke('local:list', dir) : await invoke('remote:list', { hostId: hostId!, path: dir })
      list.sort((a, b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
      if (get().hostId !== hostId) return
      set((st) => {
        const p = st[side]
        const errors = { ...p.errors }
        delete errors[dir]
        return { [side]: { ...p, entries: { ...p.entries, [dir]: list }, loading: { ...p.loading, [dir]: false }, errors, stale: false, loadedAt: Date.now() } } as Partial<BrowserStore>
      })
    } catch (e) {
      set((st) => ({ [side]: { ...st[side], loading: { ...st[side].loading, [dir]: false }, errors: { ...st[side].errors, [dir]: errorText(e) } } }) as Partial<BrowserStore>)
    }
  },

  toggle: (side, dir, open) => {
    const st = get()
    set({ [side]: { ...st[side], expanded: { ...st[side].expanded, [dir]: open } } } as Partial<BrowserStore>)
    if (open && !st[side].entries[dir]) void get().load(side, dir)
    if (st.syncScroll) {
      const other: Side = side === 'local' ? 'remote' : 'local'
      const cp = counterpart(side, dir, st.local.root, st.remote.root)
      const o = get()[other]
      const parent = cp ? parentOf(other, cp) : null
      const exists = cp && parent && o.entries[parent]?.some((e) => e.path === cp && e.type === 'dir')
      if (cp && exists) {
        set({ [other]: { ...o, expanded: { ...o.expanded, [cp]: open } } } as Partial<BrowserStore>)
        if (open && !o.entries[cp]) void get().load(other, cp)
      }
    }
  },

  refresh: async (side) => {
    const sides: Side[] = side ? [side] : ['local', 'remote']
    await Promise.all(
      sides.map(async (sd) => {
        const p = get()[sd]
        const dirs = Object.keys(p.entries).filter((d) => d === p.root || p.expanded[d])
        await Promise.all(dirs.map((d) => get().load(sd, d, true)))
      })
    )
  },

  refreshPaths: (side, paths) => {
    const p = get()[side]
    const dirs = new Set(paths.map((x) => parentOf(side, x)))
    for (const d of dirs) if (p.entries[d]) void get().load(side, d, true)
  },

  select: (side, path, mods, order) => {
    const p = get()[side]
    let sel: Set<string>
    if (mods.shift && p.anchor && order.includes(p.anchor)) {
      const a = order.indexOf(p.anchor)
      const b = order.indexOf(path)
      sel = new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1))
    } else if (mods.meta) {
      sel = new Set(p.selected)
      if (sel.has(path)) sel.delete(path)
      else sel.add(path)
    } else sel = new Set([path])
    set({ activeSide: side, [side]: { ...p, selected: sel, focused: path, anchor: mods.shift ? p.anchor : path } } as Partial<BrowserStore>)
  },

  clearSelection: (side) => set((st) => ({ [side]: { ...st[side], selected: new Set(), anchor: null } }) as Partial<BrowserStore>),
  setActiveSide: (activeSide) => set({ activeSide }),
  setFilter: (side, filter) => set((st) => ({ [side]: { ...st[side], filter } }) as Partial<BrowserStore>),
  setChip: (side, chip) => set((st) => ({ [side]: { ...st[side], chip } }) as Partial<BrowserStore>),
  setDiffOnly: (diffOnly) => set({ diffOnly }),
  setSyncScroll: (syncScroll) => set({ syncScroll }),
  setTransfersOpen: (transfersOpen) => set({ transfersOpen }),
  setTransfersTab: (transfersTab) => set({ transfersTab }),
  setPaneSplit: (r) => {
    const paneSplit = Math.min(0.85, Math.max(0.15, r))
    set({ paneSplit })
    saveLayout({ paneSplit, transfersHeight: get().transfersHeight })
  },
  setTransfersHeight: (h) => {
    const transfersHeight = Math.round(Math.max(80, h))
    set({ transfersHeight })
    saveLayout({ paneSplit: get().paneSplit, transfersHeight })
  },
  markStale: (stale) => set((st) => ({ remote: { ...st.remote, stale } }))
}))

export { parentOf }
