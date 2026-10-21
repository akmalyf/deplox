import { app, BrowserWindow, nativeTheme } from 'electron'
import { createServices, type Services } from './services'
import { registerIpc } from './ipc'
import { createWindow } from './window'

app.setName('Deplox')
// Separate profile for development and automated checks.
if (process.env.DEPLOX_USER_DATA) app.setPath('userData', process.env.DEPLOX_USER_DATA)

let services: Services | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) {
      if (w.isMinimized()) w.restore()
      w.focus()
    }
  })

  void app.whenReady().then(async () => {
    services = createServices()
    registerIpc(services)
    const settings = services.store.get().settings
    nativeTheme.themeSource = settings.theme
    if (settings.activeProjectId) await services.sync.setWatching(settings.activeProjectId, true).catch(() => undefined)
    createWindow(settings)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && services) createWindow(services.store.get().settings)
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting || !services) return
    quitting = true
    e.preventDefault()
    const s = services
    s.prompter.cancelAll()
    s.terminals.closeAll()
    s.queue.shutdown()
    void Promise.allSettled([s.sync.close(), s.conns.disconnectAll()]).finally(() => {
      s.store.flush()
      s.knownHosts.flush()
      s.snapshots.flush()
      app.quit()
    })
  })
}
