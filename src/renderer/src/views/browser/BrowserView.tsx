import { useEffect, useRef, type UIEvent } from 'react'
import { Button, Chip, Splitter } from '@/ds'
import { useActiveHost, useActiveProject, useConn } from '../../stores/app'
import { DEFAULT_PANE_SPLIT, DEFAULT_TRANSFERS_HEIGHT, useBrowser } from '../../stores/browser'
import { useUi } from '../../stores/ui'
import { invoke } from '../../lib/ipc'
import { connectHost, hostRoots, syncAll } from '../../lib/actions'
import { Crumbs, Header, PaletteTrigger, Sep } from '../../shell/HeaderParts'
import { FilePane } from './FilePane'
import { TransfersPanel } from './TransfersPanel'

const autoConnected = new Set<string>()

export function BrowserView() {
  const project = useActiveProject()
  const host = useActiveHost()
  const conn = useConn(host?.id)
  const setHost = useBrowser((s) => s.setHost)
  const setRoot = useBrowser((s) => s.setRoot)
  const remoteRoot = useBrowser((s) => s.remote.root)
  const diffOnly = useBrowser((s) => s.diffOnly)
  const syncScroll = useBrowser((s) => s.syncScroll)
  const paneSplit = useBrowser((s) => s.paneSplit)
  const transfersOpen = useBrowser((s) => s.transfersOpen)
  const panesRef = useRef<HTMLDivElement>(null)
  const localRef = useRef<HTMLDivElement>(null)
  const remoteRef = useRef<HTMLDivElement>(null)
  const scrolling = useRef<'local' | 'remote' | null>(null)

  // Point both panes at the active host's mapping.
  useEffect(() => {
    const roots = hostRoots(host, project)
    setHost(host?.id ?? null, roots.local, roots.remote)
  }, [host?.id, host?.mappings, project?.id, project?.localRoot, setHost, host, project])

  // Connect on first view; resolve the remote home when there is no mapping.
  useEffect(() => {
    if (!host) return
    if (conn.state === 'disconnected' && !conn.error && !autoConnected.has(host.id)) {
      autoConnected.add(host.id)
      void connectHost(host.id)
    }
    if (conn.state !== 'connected') return
    // Read the live store: the root from this render can be stale right after setHost().
    const live = useBrowser.getState()
    const root = live.hostId === host.id ? live.remote.root : ''
    if (!root && !host.mappings.some((m) => m.remote)) {
      // No deployment path: start in the remote home folder.
      void invoke('remote:realpath', { hostId: host.id, path: '.' })
        .then((p) => {
          const now = useBrowser.getState()
          if (now.hostId === host.id && !now.remote.root) setRoot('remote', p)
        })
        .catch(() => undefined)
    } else if (root && !live.remote.entries[root] && !live.remote.loading[root]) {
      void live.load('remote', root)
    }
  }, [host, conn.state, conn.error, remoteRoot, setRoot])

  const onScroll = (side: 'local' | 'remote') => (e: UIEvent<HTMLDivElement>) => {
    if (!syncScroll) return
    if (scrolling.current && scrolling.current !== side) return
    scrolling.current = side
    const src = e.currentTarget
    const dst = side === 'local' ? remoteRef.current : localRef.current
    if (dst) {
      const ratio = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight)
      dst.scrollTop = ratio * (dst.scrollHeight - dst.clientHeight)
    }
    requestAnimationFrame(() => (scrolling.current = null))
  }

  const connected = conn.state === 'connected'

  const dragPanes = (dx: number) => {
    const el = panesRef.current
    if (!el) return
    const width = el.clientWidth - 24 - 8 // padding and the handle
    if (width > 0) useBrowser.getState().setPaneSplit(useBrowser.getState().paneSplit + dx / width)
  }
  const dragTransfers = (dy: number) => {
    const st = useBrowser.getState()
    // Keep at least 160px for the file panes.
    const room = (panesRef.current?.clientHeight ?? 0) + st.transfersHeight - 160
    st.setTransfersHeight(Math.min(Math.max(room, 80), st.transfersHeight - dy))
  }

  return (
    <>
      <Header>
        <Crumbs>
          {host ? (
            <>
              <Sep />
              <span className="crumb-path">{remoteRoot || '…'}</span>
            </>
          ) : null}
        </Crumbs>
        <span className="spacer" />
        <PaletteTrigger />
        {host ? (
          <Button variant="primary" size="sm" icon="git-branch" disabled={!connected} onClick={() => syncAll()} title="Compare every mapped file with the server and choose what to sync">
            Sync All
          </Button>
        ) : null}
      </Header>

      {!host ? (
        <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="ad-empty ad-empty-center">
            <h2 className="ad-empty-title">Add a host to {project?.name}</h2>
            <p className="ad-empty-desc">Connect over SFTP, FTP or FTPS, then map your local folder to a deployment path</p>
            <div className="ad-empty-actions">
              <Button variant="primary" icon="plus" onClick={() => useUi.getState().editHost('new')}>
                Add Host
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div role="toolbar" aria-label="Pane options" style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 0' }}>
            <Chip shape="square" icon="filter" selected={diffOnly} onClick={() => useBrowser.getState().setDiffOnly(!diffOnly)}>
              Differences only
            </Chip>
            <Chip shape="square" selected={syncScroll} onClick={() => useBrowser.getState().setSyncScroll(!syncScroll)} title="Expand and scroll both panes together">
              Sync scroll
            </Chip>
            <Button variant="ghost" size="sm" icon="refresh" iconOnly onClick={() => void useBrowser.getState().refresh()}>
              Refresh both panes
            </Button>
            <span className="spacer" />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-muted)' }}>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>M</span>differs
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-muted)' }}>
              <span style={{ color: 'var(--success-text)', fontWeight: 600 }}>A</span>local only
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-muted)' }}>
              <span style={{ color: 'var(--success-text)', fontWeight: 600 }}>U</span>remote only
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-muted)' }}>
              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>!</span>changed on both sides
            </span>
          </div>

          <div ref={panesRef} style={{ flex: '1 1 auto', minHeight: 0, display: 'grid', gridTemplateColumns: `minmax(0, ${paneSplit}fr) 8px minmax(0, ${1 - paneSplit}fr)`, padding: '8px 12px 0' }}>
            <FilePane side="local" host={host} conn={conn} ref={localRef} onScroll={onScroll('local')} />
            <Splitter orientation="vertical" label="Resize local and remote panes" onDrag={dragPanes} onReset={() => useBrowser.getState().setPaneSplit(DEFAULT_PANE_SPLIT)} />
            <FilePane side="remote" host={host} conn={conn} ref={remoteRef} onScroll={onScroll('remote')} />
          </div>

          {transfersOpen ? (
            <Splitter orientation="horizontal" className="transfers-split" label="Resize transfers panel" onDrag={dragTransfers} onReset={() => useBrowser.getState().setTransfersHeight(DEFAULT_TRANSFERS_HEIGHT)} />
          ) : (
            <div style={{ flex: '0 0 8px' }} />
          )}

          <TransfersPanel />
        </>
      )}

    </>
  )
}
