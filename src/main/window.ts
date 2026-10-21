import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import type { Settings } from '@shared/types'

const isMac = process.platform === 'darwin'

export function applyWindowAppearance(win: BrowserWindow, settings: Settings): void {
  if (!isMac) return
  win.setVibrancy(settings.reduceTransparency ? null : 'sidebar')
}

export function createWindow(settings: Settings): BrowserWindow {
  const glass = isMac && !settings.reduceTransparency
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 640,
    show: false,
    title: 'Deplox',
    backgroundColor: glass ? '#00000000' : '#141415',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac ? undefined : { color: '#141415', symbolColor: '#b8b8b9', height: 44 },
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: glass ? 'sidebar' : undefined,
    visualEffectState: 'followWindow',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Never navigate the app window away from the renderer.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) e.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return win
}
