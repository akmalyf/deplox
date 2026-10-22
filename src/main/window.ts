import { BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import type { Settings, SyncWindowRequest } from '@shared/types'
import type { EventMap } from '@shared/ipc'

const isMac = process.platform === 'darwin'

export function applyWindowAppearance(win: BrowserWindow, settings: Settings): void {
  if (!isMac) return
  win.setVibrancy(settings.reduceTransparency ? null : 'sidebar')
}

const webPreferences: Electron.WebPreferences = {
  preload: join(import.meta.dirname, '../preload/index.cjs'),
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  spellcheck: false
}

function guard(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Never navigate an app window away from the renderer.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) e.preventDefault()
  })
  // Full screen hides the macOS traffic lights, so the renderer drops the room it keeps for them.
  // Also sent on every load, so a reload or a window restored straight into full screen starts right.
  const sendFullScreen = () => {
    if (!win.isDestroyed()) win.webContents.send('window:fullscreen', { fullScreen: win.isFullScreen() } satisfies EventMap['window:fullscreen'])
  }
  win.on('enter-full-screen', sendFullScreen)
  win.on('leave-full-screen', sendFullScreen)
  win.webContents.on('did-finish-load', sendFullScreen)
}

function loadRenderer(win: BrowserWindow, hash?: string): void {
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL + (hash ? `#${hash}` : ''))
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

let mainWindow: BrowserWindow | null = null

/** The main app window, if it is open (Sync windows don't count). */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
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
    webPreferences
  })

  win.once('ready-to-show', () => win.show())
  guard(win)
  loadRenderer(win)
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  return win
}

const syncWindows = new Map<string, BrowserWindow>()

/** Opens (or focuses) a separate Sync window for a host, optionally limited to one file or folder. */
export function openSyncWindow(req: SyncWindowRequest): void {
  const key = `${req.hostId}|${req.scope?.localPath ?? ''}`
  const open = syncWindows.get(key)
  if (open && !open.isDestroyed()) {
    if (open.isMinimized()) open.restore()
    open.focus()
    return
  }
  const parent = getMainWindow()
  const b = parent?.getBounds()
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 820,
    minHeight: 560,
    // Offset from the main window so it reads as a new window, not a page change.
    ...(b ? { x: b.x + 48, y: b.y + 48 } : {}),
    show: false,
    title: 'Sync',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141415' : '#ffffff',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences
  })
  win.once('ready-to-show', () => win.show())
  guard(win)
  loadRenderer(win, 'sync=' + encodeURIComponent(JSON.stringify(req)))
  syncWindows.set(key, win)
  win.on('closed', () => {
    if (syncWindows.get(key) === win) syncWindows.delete(key)
  })
}
