import { create } from 'zustand'
import type { PromptRequest } from '@shared/types'

export type View = 'browser' | 'compare' | 'terminal' | 'sync' | 'host' | 'settings' | 'welcome'

export interface Toast {
  id: number
  text: string
  tone: 'neutral' | 'danger' | 'success'
  action?: { label: string; run: () => void }
}

export interface ConfirmOpts {
  title: string
  description?: string
  detail?: string
  confirm: string
  danger?: boolean
  run: () => void | Promise<void>
}

export interface InputOpts {
  title: string
  description?: string
  label: string
  value?: string
  confirm: string
  mono?: boolean
  validate?: (v: string) => string | null
  run: (v: string) => void | Promise<void>
}

interface UiState {
  view: View
  /** Host being edited in the host form ('new' for a new host). */
  editHostId: string | null
  sidebarCollapsed: boolean
  paletteOpen: boolean
  projectDialog: { mode: 'new' | 'edit'; projectId?: string } | null
  prompts: PromptRequest[]
  confirm: ConfirmOpts | null
  input: InputOpts | null
  toasts: Toast[]
  setView: (v: View) => void
  editHost: (id: string | 'new') => void
  toggleSidebar: () => void
  setPalette: (open: boolean) => void
  openProjectDialog: (d: UiState['projectDialog']) => void
  pushPrompt: (p: PromptRequest) => void
  dropPrompt: (requestId: string) => void
  askConfirm: (c: ConfirmOpts | null) => void
  askInput: (c: InputOpts | null) => void
  toast: (text: string, tone?: Toast['tone'], action?: Toast['action']) => void
  dismissToast: (id: number) => void
}

let toastSeq = 0

export const useUi = create<UiState>((set, get) => ({
  view: 'browser',
  editHostId: null,
  sidebarCollapsed: false,
  paletteOpen: false,
  projectDialog: null,
  prompts: [],
  confirm: null,
  input: null,
  toasts: [],
  setView: (view) => set({ view, paletteOpen: false }),
  editHost: (id) => set({ view: 'host', editHostId: id, paletteOpen: false }),
  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  openProjectDialog: (projectDialog) => set({ projectDialog }),
  pushPrompt: (p) => set({ prompts: [...get().prompts, p] }),
  dropPrompt: (requestId) => set({ prompts: get().prompts.filter((p) => p.requestId !== requestId) }),
  askConfirm: (confirm) => set({ confirm }),
  askInput: (input) => set({ input }),
  toast: (text, tone = 'neutral', action) => {
    const id = ++toastSeq
    set({ toasts: [...get().toasts.slice(-2), { id, text, tone, action }] })
    setTimeout(() => get().dismissToast(id), action ? 8000 : tone === 'danger' ? 7000 : 4000)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

export const toast = (text: string, tone?: Toast['tone'], action?: Toast['action']) => useUi.getState().toast(text, tone, action)
