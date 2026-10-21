import { create } from 'zustand'
import type { CompareSide } from '@shared/types'
import { buildRows, groupHunks, joinText, mergeForLocal, mergeForRemote, splitText, type DiffRow, type Hunk } from '@shared/compare'
import { invoke, errorCode, errorText } from '../lib/ipc'
import { toast } from './ui'

export interface ComparePair {
  hostId: string
  localPath: string
  remotePath: string
}

interface CompareStore {
  pair: ComparePair | null
  loading: boolean
  error: string | null
  local: CompareSide | null
  remote: CompareSide | null
  remoteNewer: boolean
  rows: DiffRow[]
  hunks: Hunk[]
  selected: Set<string>
  ignoreWs: boolean
  showPreview: boolean
  previewSide: 'remote' | 'local'
  cursor: number
  writing: boolean
  open: (p: ComparePair) => Promise<void>
  reload: () => Promise<void>
  close: () => void
  toggleRow: (id: string) => void
  selectHunk: (hunkId: number, side: 'remote' | 'local') => void
  selectAll: () => void
  selectNone: () => void
  setIgnoreWs: (b: boolean) => void
  setShowPreview: (b: boolean) => void
  setPreviewSide: (s: 'remote' | 'local') => void
  setCursor: (n: number) => void
  apply: (target: 'remote' | 'local', onlyHunk?: number) => Promise<void>
}

function rebuild(local: CompareSide, remote: CompareSide, ignoreWs: boolean) {
  const rows = buildRows(splitText(local.text).lines, splitText(remote.text).lines, { ignoreWhitespace: ignoreWs })
  return { rows, hunks: groupHunks(rows) }
}

export const useCompare = create<CompareStore>((set, get) => ({
  pair: null,
  loading: false,
  error: null,
  local: null,
  remote: null,
  remoteNewer: false,
  rows: [],
  hunks: [],
  selected: new Set(),
  ignoreWs: false,
  showPreview: true,
  previewSide: 'remote',
  cursor: 0,
  writing: false,

  open: async (pair) => {
    set({ pair, loading: true, error: null, selected: new Set(), cursor: 0 })
    try {
      const r = await invoke('compare:load', pair)
      if (get().pair !== pair) return
      set({ local: r.local, remote: r.remote, remoteNewer: r.remoteNewerThanSnapshot, loading: false, ...rebuild(r.local, r.remote, get().ignoreWs) })
    } catch (e) {
      if (get().pair !== pair) return
      set({ loading: false, error: errorText(e), local: null, remote: null, rows: [], hunks: [] })
    }
  },

  reload: async () => {
    const p = get().pair
    if (p) await get().open({ ...p })
  },

  close: () => set({ pair: null, local: null, remote: null, rows: [], hunks: [], error: null }),

  toggleRow: (id) => {
    const s = new Set(get().selected)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    set({ selected: s })
  },

  selectHunk: (hunkId, side) => {
    const h = get().hunks.find((x) => x.id === hunkId)
    if (!h) return
    const s = new Set(get().selected)
    const all = h.rowIds.every((id) => s.has(id)) && get().previewSide === side
    for (const id of h.rowIds) {
      if (all) s.delete(id)
      else s.add(id)
    }
    set({ selected: s, previewSide: side, showPreview: true, cursor: get().hunks.indexOf(h) })
  },

  selectAll: () => set({ selected: new Set(get().rows.filter((r) => r.kind).map((r) => r.id)) }),
  selectNone: () => set({ selected: new Set() }),

  setIgnoreWs: (ignoreWs) => {
    const { local, remote } = get()
    set({ ignoreWs, selected: new Set(), cursor: 0, ...(local && remote ? rebuild(local, remote, ignoreWs) : {}) })
  },

  setShowPreview: (showPreview) => set({ showPreview }),
  setPreviewSide: (previewSide) => set({ previewSide }),
  setCursor: (cursor) => set({ cursor: Math.max(0, Math.min(get().hunks.length - 1, cursor)) }),

  apply: async (target, onlyHunk) => {
    const { pair, local, remote, rows, hunks } = get()
    if (!pair || !local || !remote) return
    let selected = get().selected
    if (onlyHunk != null) selected = new Set(hunks.find((h) => h.id === onlyHunk)?.rowIds ?? [])
    if (!selected.size) return
    const lines = target === 'remote' ? mergeForRemote(rows, selected) : mergeForLocal(rows, selected)
    const side = target === 'remote' ? remote : local
    const text = joinText(lines, side)
    set({ writing: true })
    try {
      if (target === 'remote') {
        await invoke('compare:writeRemote', { hostId: pair.hostId, path: pair.remotePath, otherPath: pair.localPath, text, expectedMtime: remote.mtime, expectedSize: remote.size })
      } else {
        await invoke('compare:writeLocal', { hostId: pair.hostId, path: pair.localPath, otherPath: pair.remotePath, text, expectedMtime: local.mtime, expectedSize: local.size })
      }
      const n = [...selected].filter((id) => rows.find((r) => r.id === id)?.kind).length
      toast(`${n} line${n === 1 ? '' : 's'} ${target === 'remote' ? 'uploaded to the server' : 'taken into your local file'}`, 'success')
      set({ writing: false, selected: new Set() })
      await get().reload()
    } catch (e) {
      set({ writing: false })
      if (errorCode(e) === 'ESTALE') toast(`${errorText(e)}. Reload to see the latest version.`, 'danger', { label: 'Reload', run: () => void get().reload() })
      else toast(errorText(e), 'danger')
    }
  }
}))
