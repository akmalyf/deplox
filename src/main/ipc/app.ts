import { BrowserWindow, clipboard, dialog, nativeTheme, shell } from 'electron'
import type { Project, Settings } from '@shared/types'
import { handle } from './register'
import type { Services } from '../services'
import { applyWindowAppearance, openSyncWindow } from '../window'

export function registerApp(s: Services): void {
  handle('app:openSyncWindow', (req) => openSyncWindow(req))

  handle('app:getState', () => {
    const st = s.store.get()
    const q = s.queue.snapshot()
    return {
      settings: st.settings,
      projects: st.projects,
      hosts: s.publicHosts(),
      snippets: st.snippets,
      conns: s.conns.allStates(),
      jobs: q.jobs,
      groups: q.groups,
      log: q.log,
      sessions: s.terminals.list(),
      sync: s.sync.list(),
      secretsAvailable: s.secrets.available(),
      platform: process.platform,
      homeDir: s.home
    }
  })

  handle('app:updateSettings', (patch) => {
    const next = s.store.update((st) => ({ ...st, settings: { ...st.settings, ...patch } as Settings })).settings
    if (patch.theme) nativeTheme.themeSource = patch.theme
    if (patch.reduceTransparency != null) for (const w of BrowserWindow.getAllWindows()) applyWindowAppearance(w, next)
    s.broadcastStore()
    return next
  })

  handle('app:pickPath', async ({ kind, defaultPath, title }) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts: Electron.OpenDialogOptions = {
      title,
      defaultPath: defaultPath?.replace(/^~/, s.home),
      properties: kind === 'folder' ? ['openDirectory', 'createDirectory'] : ['openFile', 'showHiddenFiles']
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  handle('app:revealPath', (p) => shell.showItemInFolder(p.replace(/^~/, s.home)))
  handle('app:copyText', (t) => clipboard.writeText(t))

  handle('projects:save', (p: Project) => {
    s.store.update((st) => {
      const exists = st.projects.some((x) => x.id === p.id)
      return { ...st, projects: exists ? st.projects.map((x) => (x.id === p.id ? p : x)) : [...st.projects, p] }
    })
    s.broadcastStore()
    return s.store.get().projects
  })

  handle('projects:delete', async (id) => {
    const hosts = s.store.get().hosts.filter((h) => h.projectId === id)
    for (const h of hosts) {
      s.conns.forget(h.id)
      s.queue.dropHost(h.id)
      s.secrets.deleteHost(h.id)
      s.sync.dropHost(h.id)
      s.snapshots.dropHost(h.id)
    }
    s.store.update((st) => {
      const projects = st.projects.filter((p) => p.id !== id)
      const active = st.settings.activeProjectId === id ? projects[0]?.id : st.settings.activeProjectId
      return { ...st, projects, hosts: st.hosts.filter((h) => h.projectId !== id), settings: { ...st.settings, activeProjectId: active } }
    })
    s.broadcastStore()
    return s.store.get().projects
  })

  handle('projects:open', async (id) => {
    const next = s.store.update((st) => ({
      ...st,
      projects: st.projects.map((p) => (p.id === id ? { ...p, lastOpenedAt: Date.now() } : p)),
      settings: { ...st.settings, activeProjectId: id, activeHostId: st.hosts.find((h) => h.projectId === id)?.id }
    }))
    await s.sync.setWatching(id, true)
    s.broadcastStore()
    return next.settings
  })

  handle('snippets:save', (list) => {
    s.store.update((st) => ({ ...st, snippets: list }))
    s.broadcastStore()
    return s.store.get().snippets
  })

  handle('prompt:answer', ({ requestId, answer }) => s.prompter.answer(requestId, answer))
}
