import { useApp } from './app'
import { useUi } from './ui'
import { useTransfers } from './transfers'
import { useTerminal, terminalBus } from './terminal'
import { useSync } from './sync'
import { useCompare } from './compare'
import { useBrowser } from './browser'

let bound = false

export function bindEvents(): void {
  if (bound) return
  bound = true
  const d = window.deplox
  d.on('store:changed', (p) => useApp.getState().applyStore(p))
  d.on('conn:state', (c) => {
    const prev = useApp.getState().conns[c.hostId]
    useApp.getState().setConn(c)
    const b = useBrowser.getState()
    if (b.hostId !== c.hostId) return
    if (c.state === 'connected' && prev?.state !== 'connected') {
      b.markStale(false)
      void b.refresh('remote')
    } else if (c.state !== 'connected' && prev?.state === 'connected') b.markStale(true)
  })
  d.on('prompt:open', (p) => useUi.getState().pushPrompt(p))
  d.on('prompt:cancel', ({ requestId }) => useUi.getState().dropPrompt(requestId))
  d.on('transfers:update', (u) => {
    useTransfers.getState().update(u)
    // Refresh listings touched by finished transfers.
    const b = useBrowser.getState()
    for (const j of u.jobs) {
      if (j.state !== 'done' || j.hostId !== b.hostId || j.groupId) continue
      if (j.kind === 'upload' || j.kind === 'delete-remote' || j.kind === 'mkdir-remote') b.refreshPaths('remote', [j.remotePath])
      if (j.kind === 'download' || j.kind === 'delete-local' || j.kind === 'mkdir-local') b.refreshPaths('local', [j.localPath])
    }
    for (const g of u.groups) {
      if (g.state !== 'done' || g.hostId !== b.hostId) continue
      void b.refresh(g.kind === 'download' ? 'local' : 'remote')
    }
  })
  d.on('transfers:progress', (p) => useTransfers.getState().progress(p))
  d.on('transfers:log', (e) => useTransfers.getState().addLog(e))
  d.on('terminal:data', ({ sessionId, chunk }) => terminalBus.emit(sessionId, chunk))
  d.on('terminal:exit', ({ sessionId, code, reason }) => useTerminal.getState().setExited(sessionId, code, reason))
  d.on('terminal:info', ({ sessionId, info }) => useTerminal.getState().setInfo(sessionId, info))
  d.on('sync:items', ({ items }) => useSync.getState().setItems(items))
  d.on('app:toast', ({ text, tone }) => useUi.getState().toast(text, tone))
  d.on('app:openCompare', (p) => {
    useUi.getState().setView('compare')
    void useCompare.getState().open(p)
  })
}
