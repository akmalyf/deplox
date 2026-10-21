import { create } from 'zustand'
import type { SyncItem } from '@shared/types'

export type SyncFilter = 'all' | 'upload' | 'download' | 'delete-remote' | 'attn'

interface SyncStore {
  items: SyncItem[]
  filter: SyncFilter
  query: string
  selected: Set<string>
  activeId: string | null
  scanning: boolean
  setItems: (items: SyncItem[]) => void
  setFilter: (f: SyncFilter) => void
  setQuery: (q: string) => void
  toggle: (id: string) => void
  setSelected: (s: Set<string>) => void
  setActive: (id: string | null) => void
  setScanning: (b: boolean) => void
}

export const useSync = create<SyncStore>((set, get) => ({
  items: [],
  filter: 'all',
  query: '',
  selected: new Set(),
  activeId: null,
  scanning: false,
  setItems: (items) => {
    const ids = new Set(items.map((i) => i.id))
    const selected = new Set([...get().selected].filter((s) => ids.has(s)))
    set({ items, selected })
  },
  setFilter: (filter) => set({ filter }),
  setQuery: (query) => set({ query }),
  toggle: (id) => {
    const s = new Set(get().selected)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    set({ selected: s })
  },
  setSelected: (selected) => set({ selected }),
  setActive: (activeId) => set({ activeId }),
  setScanning: (scanning) => set({ scanning })
}))
