import { BrowserWindow } from 'electron'
import type { EventChannel, EventMap } from '@shared/ipc'

/** Send an event to every renderer window. */
export function emit<K extends EventChannel>(channel: K, payload: EventMap[K]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function toast(text: string, tone: 'neutral' | 'danger' | 'success' = 'neutral'): void {
  emit('app:toast', { text, tone })
}
