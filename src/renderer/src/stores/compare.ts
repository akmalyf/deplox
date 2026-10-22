import { create } from 'zustand'
import type { CompareSide } from '@shared/types'
import { buildRows, groupHunks, joinText, mergeForLocal, mergeForRemote, splitText, type DiffRow, type Hunk } from '@shared/compare'
import { invoke, errorCode, errorText, isMac } from '../lib/ipc'
import { toast } from './ui'

export interface ComparePair {
  hostId: string
  localPath: string
  remotePath: string
}

/** One write made from Compare: the side's text before and after it. */
interface Edit {
  target: 'remote' | 'local'
  before: string
  after: string
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
  cursor: number
  /** Bumped on explicit navigation (next/prev, hunk select) so the view knows when to scroll. */
  navTick: number
  writing: boolean
  undoStack: Edit[]
  redoStack: Edit[]
  open: (p: ComparePair, quiet?: boolean) => Promise<void>
  reload: () => Promise<void>
  applyWritten: (target: 'remote' | 'local', text: string, written: { mtime: number; size: number }) => void
  close: () => void
  selectAll: () => void
  setIgnoreWs: (b: boolean) => void
  setCursor: (n: number) => void
  apply: (target: 'remote' | 'local', onlyHunk?: number) => Promise<void>
  undo: () => Promise<void>
  redo: () => Promise<void>
}

function rebuild(local: CompareSide, remote: CompareSide, ignoreWs: boolean) {
  const rows = buildRows(splitText(local.text).lines, splitText(remote.text).lines, { ignoreWhitespace: ignoreWs })
  return { rows, hunks: groupHunks(rows) }
}

function writeSide(pair: ComparePair, target: 'remote' | 'local', text: string, expectedMtime: number, expectedSize: number) {
  return target === 'remote'
    ? invoke('compare:writeRemote', { hostId: pair.hostId, path: pair.remotePath, otherPath: pair.localPath, text, expectedMtime, expectedSize })
    : invoke('compare:writeLocal', { hostId: pair.hostId, path: pair.localPath, otherPath: pair.remotePath, text, expectedMtime, expectedSize })
}

const samePair = (a: ComparePair | null, b: ComparePair | null) =>
  !!a && !!b && a.hostId === b.hostId && a.localPath === b.localPath && a.remotePath === b.remotePath

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
  cursor: 0,
  navTick: 0,
  writing: false,
  undoStack: [],
  redoStack: [],

  open: async (pair, quiet = false) => {
    // A quiet reload keeps the current diff on screen (and its scroll) until fresh data arrives.
    const keep = quiet && !!get().local && !!get().remote
    // History belongs to one file pair; opening another one starts fresh.
    if (!samePair(get().pair, pair)) set({ undoStack: [], redoStack: [] })
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

  close: () => set({ pair: null, local: null, remote: null, rows: [], hunks: [], error: null, undoStack: [], redoStack: [] }),

  selectAll: () => set({ selected: new Set(get().rows.filter((r) => r.kind).map((r) => r.id)) }),

  setIgnoreWs: (ignoreWs) => {
    const { local, remote } = get()
    set({ ignoreWs, selected: new Set(), cursor: 0, ...(local && remote ? rebuild(local, remote, ignoreWs) : {}) })
  },

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
    try {
      const written = await writeSide(pair, target, text, side.mtime, side.size)
      const n = [...selected].filter((id) => rows.find((r) => r.id === id)?.kind).length
      // The previous content stays in memory so a mistaken click can be reverted (⌘Z / Ctrl+Z).
      // A file created by this write has no previous content to go back to.
      const edit: Edit | null = side.exists ? { target, before: side.text, after: text } : null
      set({ writing: false, ...(edit ? { undoStack: [...get().undoStack, edit], redoStack: [] } : {}) })
      toast(`${n} line${n === 1 ? '' : 's'} ${target === 'remote' ? 'uploaded to the server' : 'taken into your local file'}`, 'success', edit
        ? {
            label: 'Undo',
            run: () => {
              // Only the latest change can be undone from its toast; older ones go through ⌘Z in order.
              if (get().undoStack.at(-1) === edit) void get().undo()
              else toast(`Newer changes were made since. Press ${isMac ? '⌘Z' : 'Ctrl+Z'} to step back.`)
            }
          }
        : undefined)
      get().applyWritten(target, text, written)
    } catch (e) {
      set({ writing: false })
      if (errorCode(e) === 'ESTALE') toast(`${errorText(e)}. Reload to see the latest version.`, 'danger', { label: 'Reload', run: () => void get().reload() })
      else toast(errorText(e), 'danger')
    }
  },

  undo: () => step('undo'),
  redo: () => step('redo')
}))

/** Moves one edit between the undo and redo stacks, writing the matching text back to its side. */
async function step(dir: 'undo' | 'redo') {
  const { pair, local, remote, writing, undoStack, redoStack } = useCompare.getState()
  const from = dir === 'undo' ? undoStack : redoStack
  const edit = from.at(-1)
  if (!pair || !local || !remote || writing || !edit) return
  const side = edit.target === 'remote' ? remote : local
  const text = dir === 'undo' ? edit.before : edit.after
  useCompare.setState({ writing: true })
  try {
    const written = await writeSide(pair, edit.target, text, side.mtime, side.size)
    const s = useCompare.getState()
    useCompare.setState(
      dir === 'undo'
        ? { writing: false, undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, edit] }
        : { writing: false, redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, edit] }
    )
    s.applyWritten(edit.target, text, written)
    toast(dir === 'undo' ? `Undid change on ${edit.target === 'remote' ? 'the server' : 'your local file'}` : `Redid change on ${edit.target === 'remote' ? 'the server' : 'your local file'}`)
  } catch (e) {
    useCompare.setState({ writing: false })
    if (errorCode(e) === 'ESTALE') {
      // The file changed outside Compare, so the recorded history no longer applies to it.
      useCompare.setState({ undoStack: [], redoStack: [] })
      toast(`${errorText(e)}. History cleared; reload to see the latest version.`, 'danger', { label: 'Reload', run: () => void useCompare.getState().reload() })
    } else toast(`${dir === 'undo' ? 'Undo' : 'Redo'} failed: ${errorText(e)}`, 'danger')
  }
}
