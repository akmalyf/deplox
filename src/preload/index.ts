import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, SEND_CHANNELS, type DeploxApi } from '../shared/ipc'

const invokeOk = new Set<string>(INVOKE_CHANNELS)
const sendOk = new Set<string>(SEND_CHANNELS)
const eventOk = new Set<string>(EVENT_CHANNELS)

const api: DeploxApi = {
  invoke: ((channel: string, req?: unknown) => {
    if (!invokeOk.has(channel)) return Promise.reject(new Error(`[EUNKNOWN] Blocked channel ${channel}`))
    return ipcRenderer.invoke(channel, req)
  }) as DeploxApi['invoke'],
  send: (channel, payload) => {
    if (sendOk.has(channel)) ipcRenderer.send(channel, payload)
  },
  on: (channel, cb) => {
    if (!eventOk.has(channel)) return () => undefined
    const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload as Parameters<typeof cb>[0])
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('deplox', api)
