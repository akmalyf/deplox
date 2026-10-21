import { create } from 'zustand'
import type { SessionInfo } from '@shared/types'

export interface TermSession {
  id: string
  info: SessionInfo
  exited?: { code: number | null; reason?: string }
}

interface TerminalStore {
  sessions: TermSession[]
  activeId: string | null
  init: (list: { id: string; info: SessionInfo }[]) => void
  add: (s: TermSession) => void
  setInfo: (id: string, info: SessionInfo) => void
  setExited: (id: string, code: number | null, reason?: string) => void
  remove: (id: string) => void
  setActive: (id: string | null) => void
}

export const useTerminal = create<TerminalStore>((set, get) => ({
  sessions: [],
  activeId: null,
  init: (list) => set({ sessions: list.map((s) => ({ id: s.id, info: s.info })), activeId: list[0]?.id ?? null }),
  add: (s) => set({ sessions: [...get().sessions, s], activeId: s.id }),
  setInfo: (id, info) => set({ sessions: get().sessions.map((s) => (s.id === id ? { ...s, info } : s)) }),
  setExited: (id, code, reason) => set({ sessions: get().sessions.map((s) => (s.id === id ? { ...s, exited: { code, reason } } : s)) }),
  remove: (id) => {
    const list = get().sessions
    const i = list.findIndex((s) => s.id === id)
    const next = list.filter((s) => s.id !== id)
    const activeId = get().activeId === id ? (next[Math.max(0, i - 1)]?.id ?? null) : get().activeId
    set({ sessions: next, activeId })
  },
  setActive: (activeId) => set({ activeId })
}))

/** Terminal output bypasses React state: XtermPane subscribes per session. */
type DataListener = (chunk: Uint8Array) => void
const listeners = new Map<string, Set<DataListener>>()
const backlog = new Map<string, Uint8Array[]>()

export const terminalBus = {
  emit(sessionId: string, chunk: Uint8Array): void {
    const ls = listeners.get(sessionId)
    if (ls && ls.size) for (const l of ls) l(chunk)
    else {
      // Keep output that arrives before the pane mounts.
      const b = backlog.get(sessionId) ?? []
      b.push(chunk)
      backlog.set(sessionId, b)
    }
  },
  subscribe(sessionId: string, fn: DataListener): () => void {
    let ls = listeners.get(sessionId)
    if (!ls) listeners.set(sessionId, (ls = new Set()))
    ls.add(fn)
    const b = backlog.get(sessionId)
    if (b) {
      backlog.delete(sessionId)
      for (const c of b) fn(c)
    }
    return () => ls!.delete(fn)
  }
}
