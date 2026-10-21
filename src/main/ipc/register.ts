import { ipcMain } from 'electron'
import type { InvokeChannel, InvokeMap, SendChannel, SendMap } from '@shared/ipc'
import { toRemoteFsError } from '../remote/errors'

type Handler<K extends InvokeChannel> = (req: InvokeMap[K][0]) => Promise<InvokeMap[K][1]> | InvokeMap[K][1]

export function handle<K extends InvokeChannel>(channel: K, fn: Handler<K>): void {
  ipcMain.handle(channel, async (_e, req: InvokeMap[K][0]) => {
    try {
      return await fn(req)
    } catch (err) {
      const e = toRemoteFsError(err)
      if (e.code !== 'EABORT' && e.code !== 'ESTALE') console.error(`[ipc] ${channel}:`, e.message)
      // Only the message survives IPC; it carries "[CODE] detail".
      throw new Error(e.message)
    }
  })
}

export function on<K extends SendChannel>(channel: K, fn: (payload: SendMap[K]) => void): void {
  ipcMain.on(channel, (_e, payload: SendMap[K]) => {
    try {
      fn(payload)
    } catch (err) {
      console.error(`[ipc] ${channel}:`, err)
    }
  })
}
