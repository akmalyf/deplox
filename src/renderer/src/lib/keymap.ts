import { useUi } from '../stores/ui'
import { useApp } from '../stores/app'
import { compareSelection, downloadSelection, uploadSelection } from './actions'
import { isMac } from './ipc'

function editable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  if (el.closest('.xterm')) return true
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

/** One global keydown dispatcher for app shortcuts. */
export function installKeymap(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const mod = isMac ? e.metaKey : e.ctrlKey
    const ui = useUi.getState()
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      ui.setPalette(!ui.paletteOpen)
      return
    }
    if (ui.paletteOpen || ui.confirm || ui.input || ui.prompts.length || ui.projectDialog) return
    if (mod && !e.altKey && !e.shiftKey) {
      const views = { '1': 'browser', '2': 'compare', '3': 'terminal', '4': 'sync' } as const
      if (e.key in views) {
        e.preventDefault()
        ui.setView(views[e.key as keyof typeof views])
        return
      }
      if (e.key === ',') {
        e.preventDefault()
        ui.setView('settings')
        return
      }
      if (e.key === 'b' && !editable(e.target)) {
        e.preventDefault()
        ui.toggleSidebar()
        return
      }
    }
    if (e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
      const s = useApp.getState()
      const sorted = [...s.projects].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
      const p = sorted[Number(e.key) - 1]
      if (p) {
        e.preventDefault()
        void window.deplox.invoke('projects:open', p.id).then((settings) => useApp.setState({ settings }))
      }
      return
    }
    if (editable(e.target) || ui.view !== 'browser') return
    if (mod && e.altKey && e.key === 'ArrowUp') {
      e.preventDefault()
      void uploadSelection()
    } else if (mod && e.altKey && e.key === 'ArrowDown') {
      e.preventDefault()
      void downloadSelection()
    } else if (mod && !e.altKey && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      compareSelection()
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
