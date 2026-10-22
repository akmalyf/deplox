import { create } from 'zustand'
import type { SyncAction, SyncCompareRequest, SyncDiff, SyncStatus } from '@shared/types'
import { invoke, errorText } from '../lib/ipc'
import { useCompare } from './compare'
import { toast } from './ui'

export type SyncScope = NonNullable<SyncCompareRequest['scope']>

/** Actions a row can take: a file on one side only can be copied over or left alone. */
export function actionsFor(status: SyncStatus): SyncAction[] {
  if (status === 'local-only') return ['upload', 'skip']
  if (status === 'remote-only') return ['download', 'skip']
  return ['upload', 'download', 'skip']
}

interface SyncDialogStore {
  open: boolean
  hostId: string | null
  scope: SyncScope | null
  loading: boolean
  error: string | null
  rows: SyncDiff[]
  /** Chosen action per row, keyed by remote path. */
  actions: Record<string, SyncAction>
  /** Rows made identical by line merges in the diff below; nothing left to sync. */
  resolved: Set<string>
  active: string | null
  query: string
  applying: boolean
  openSync: (hostId: string, scope?: SyncScope) => void
  rescan: () => Promise<void>
  close: () => void
  setActive: (key: string | null) => void
  setAction: (key: string, a: SyncAction) => void
  cycle: (key: string) => void
  setAll: (keys: string[], a: SyncAction) => void
  setQuery: (q: string) => void
  markResolved: (key: string) => void
  /** Queues the chosen actions: every row, or only `keys`. */
  apply: (keys?: Set<string>) => Promise<void>
}

let seq = 0

export const useSyncDialog = create<SyncDialogStore>((set, get) => ({
  open: false,
  hostId: null,
  scope: null,
  loading: false,
  error: null,
  rows: [],
  actions: {},
  resolved: new Set(),
  active: null,
  query: '',
  applying: false,

  openSync: (hostId, scope) => {
    set({ open: true, hostId, scope: scope ?? null, rows: [], actions: {}, resolved: new Set(), active: scope && !scope.isDir ? scope.remotePath : null, query: '', error: null })
    useCompare.getState().close()
    // A single file always shows its diff, even when it turns out to be in sync.
    if (scope && !scope.isDir) void useCompare.getState().open({ hostId, localPath: scope.localPath, remotePath: scope.remotePath })
    void get().rescan()
  },

  rescan: async () => {
    const { hostId, scope } = get()
    if (!hostId) return
    const n = ++seq
    set({ loading: true, error: null })
    try {
      const rows = await invoke('sync:compare', { hostId, scope: scope ?? undefined })
      if (n !== seq || !get().open) return
      const actions: Record<string, SyncAction> = {}
      for (const r of rows) actions[r.remotePath] = get().actions[r.remotePath] ?? r.action
      const keep = rows.some((r) => r.remotePath === get().active)
      set({ rows, actions, resolved: new Set(), loading: false, ...(keep ? {} : { active: null }) })
      if (!keep && rows.length) get().setActive(rows[0].remotePath)
    } catch (e) {
      if (n !== seq) return
      set({ loading: false, error: errorText(e) })
    }
  },

  close: () => {
    seq++
    set({ open: false, rows: [], actions: {}, active: null, loading: false })
    useCompare.getState().close()
  },

  setActive: (key) => {
    const { hostId, rows, active } = get()
    if (key === active) return
    set({ active: key })
    const r = rows.find((x) => x.remotePath === key)
    if (hostId && r) void useCompare.getState().open({ hostId, localPath: r.localPath, remotePath: r.remotePath })
  },

  setAction: (key, a) => set({ actions: { ...get().actions, [key]: a } }),

  cycle: (key) => {
    const r = get().rows.find((x) => x.remotePath === key)
    if (!r || get().resolved.has(key)) return
    const opts = actionsFor(r.status)
    const cur = get().actions[key] ?? r.action
    get().setAction(key, opts[(opts.indexOf(cur) + 1) % opts.length])
  },

  setAll: (keys, a) => {
    const next = { ...get().actions }
    for (const k of keys) {
      const r = get().rows.find((x) => x.remotePath === k)
      if (r && !get().resolved.has(k) && actionsFor(r.status).includes(a)) next[k] = a
    }
    set({ actions: next })
  },

  setQuery: (query) => set({ query }),

  markResolved: (key) => {
    if (get().resolved.has(key)) return
    set({ resolved: new Set([...get().resolved, key]) })
  },

  apply: async (keys) => {
    const { hostId, rows, actions, resolved } = get()
    if (!hostId) return
    const items = rows
      .filter((r) => !resolved.has(r.remotePath) && (!keys || keys.has(r.remotePath)))
      .map((r) => ({ r, action: actions[r.remotePath] ?? r.action }))
      .filter((x): x is { r: SyncDiff; action: 'upload' | 'download' } => x.action !== 'skip')
    if (!items.length) return
    set({ applying: true })
    try {
      await invoke('sync:apply', { hostId, items: items.map(({ r, action }) => ({ localPath: r.localPath, remotePath: r.remotePath, action })) })
      const up = items.filter((x) => x.action === 'upload').length
      const down = items.length - up
      toast([up && `${up} to upload`, down && `${down} to download`].filter(Boolean).join(' · ') + ' queued', 'success')
      // Queued rows leave the list; whatever was skipped stays for another pass.
      const done = new Set(items.map((x) => x.r.remotePath))
      const left = get().rows.filter((r) => !done.has(r.remotePath))
      set({ rows: left, applying: false })
      if (get().active && done.has(get().active!)) {
        set({ active: null })
        useCompare.getState().close()
        if (left.length) get().setActive(left[0].remotePath)
      }
    } catch (e) {
      set({ applying: false })
      toast(errorText(e), 'danger')
    }
  }
}))
