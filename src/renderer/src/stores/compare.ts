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
  /** Bumped on explicit navigation (next/prev, hunk select) so the view knows when to scroll. */
  navTick: number
  writing: boolean
  open: (p: ComparePair, quiet?: boolean) => Promise<void>
  reload: () => Promise<void>
  applyWritten: (target: 'remote' | 'local', text: string, written: { mtime: number; size: number }) => void
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
  navTick: 0,
  writing: false,

  open: async (pair, quiet = false) => {
    // A quiet reload keeps the current diff on screen (and its scroll) until fresh data arrives.
    const keep = quiet && !!get().local && !!get().remote
    set(keep ? { pair } : { pair, loading: true, error: null, selected: new Set(), cursor: 0 })
    try {
      const r = await invoke('compare:load', pair)
      if (get().pair !== pair) return
      const next = rebuild(r.local, r.remote, get().ignoreWs)
      set({
        local: r.local,
        remote: r.remote,
        remoteNewer: r.remoteNewerThanSnapshot,
        loading: false,
        error: null,
        ...next,
        ...(keep ? { cursor: Math.min(get().cursor, Math.max(0, next.hunks.length - 1)), selected: new Set() } : {})
      })
    } catch (e) {
      if (get().pair !== pair) return
      set({ loading: false, error: errorText(e), local: null, remote: null, rows: [], hunks: [] })
    }
  },

  reload: async () => {
    const p = get().pair
    if (p) await get().open({ ...p }, true)
  },

  applyWritten: (target, text, written) => {
    const { local, remote, ignoreWs, cursor } = get()
    if (!local || !remote) return
    const sp = splitText(text)
    const updated: CompareSide = { text, eol: sp.eol, bom: sp.bom, trailingNewline: sp.trailingNewline, mtime: written.mtime, size: written.size, exists: true }
    const nl = target === 'local' ? updated : local
    const nr = target === 'remote' ? updated : remote
    const next = rebuild(nl, nr, ignoreWs)
    // Stay on the same position: the next difference slides into the applied one's place.
    set({ local: nl, remote: nr, ...next, selected: new Set(), cursor: Math.min(cursor, Math.max(0, next.hunks.length - 1)) })
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
  setCursor: (cursor) => set({ cursor: Math.max(0, Math.min(get().hunks.length - 1, cursor)), navTick: get().navTick + 1 }),

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
    const write = (t: string, expectedMtime: number, expectedSize: number) =>
      target === 'remote'
        ? invoke('compare:writeRemote', { hostId: pair.hostId, path: pair.remotePath, otherPath: pair.localPath, text: t, expectedMtime, expectedSize })
        : invoke('compare:writeLocal', { hostId: pair.hostId, path: pair.localPath, otherPath: pair.remotePath, text: t, expectedMtime, expectedSize })
    try {
      const written = await write(text, side.mtime, side.size)
      const n = [...selected].filter((id) => rows.find((r) => r.id === id)?.kind).length
      // The previous content stays in memory so a mistaken click can be reverted.
      const previous = side.text
      const existed = side.exists
      toast(`${n} line${n === 1 ? '' : 's'} ${target === 'remote' ? 'uploaded to the server' : 'taken into your local file'}`, 'success', existed
        ? {
            label: 'Undo',
            run: () =>
              void write(previous, written.mtime, written.size)
                .then((w) => {
                  get().applyWritten(target, previous, w)
                  toast('Change undone')
                })
                .catch((e) => toast(`Undo failed: ${errorText(e)}`, 'danger'))
          }
        : undefined)
      set({ writing: false })
      get().applyWritten(target, text, written)
    } catch (e) {
      set({ writing: false })
      if (errorCode(e) === 'ESTALE') toast(`${errorText(e)}. Reload to see the latest version.`, 'danger', { label: 'Reload', run: () => void get().reload() })
      else toast(errorText(e), 'danger')
    }
  }
}))
