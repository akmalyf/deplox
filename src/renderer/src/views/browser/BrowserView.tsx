import { useEffect, useRef, type UIEvent } from 'react'
import { Button, Chip, Icon } from '@/ds'
import { formatAgo } from '@shared/format'
import { useActiveHost, useActiveProject, useConn } from '../../stores/app'
import { useBrowser } from '../../stores/browser'
import { useTransfers } from '../../stores/transfers'
import { useUi } from '../../stores/ui'
import { ALT, MOD, invoke } from '../../lib/ipc'
import { connectHost, downloadSelection, hostRoots, uploadSelection } from '../../lib/actions'
import { ConnStatus, Crumbs, Header, PaletteTrigger, Sep } from '../../shell/HeaderParts'
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
  const localRoot = useBrowser((s) => s.local.root)
  const diffOnly = useBrowser((s) => s.diffOnly)
  const syncScroll = useBrowser((s) => s.syncScroll)
  const localSel = useBrowser((s) => s.local.selected.size)
  const remoteSel = useBrowser((s) => s.remote.selected.size)
  const lastDone = useTransfers((s) => Object.values(s.jobs).reduce((m, j) => (j.state === 'done' && j.finishedAt && j.finishedAt > m ? j.finishedAt : m), 0))
  const setView = useUi((s) => s.setView)
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
    if (conn.state === 'connected' && !remoteRoot) {
      void invoke('remote:realpath', { hostId: host.id, path: '.' }).then((p) => setRoot('remote', p)).catch(() => undefined)
    } else if (conn.state === 'connected' && remoteRoot && !useBrowser.getState().remote.entries[remoteRoot] && !useBrowser.getState().remote.loading[remoteRoot]) {
      void useBrowser.getState().load('remote', remoteRoot)
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
  const mapping = host?.mappings[0]

  return (
    <>
      <Header>
        <Crumbs>
          {host ? (
            <>
              <Sep />
              <span className="crumb-path">{remoteRoot || '…'}</span>
              <ConnStatus hostId={host.id} />
            </>
          ) : null}
        </Crumbs>
        <span className="spacer" />
        <PaletteTrigger />
        <Button variant="ghost" size="sm" icon="arrow-up-right" disabled={!connected || (!localSel && !remoteSel)} onClick={() => void uploadSelection()} title={`Upload selection (${ALT}${MOD}↑)`}>
          Upload
        </Button>
        <Button variant="ghost" size="sm" icon="arrow-down" disabled={!connected || (!localSel && !remoteSel)} onClick={() => void downloadSelection()} title={`Download selection (${ALT}${MOD}↓)`}>
          Download
        </Button>
        <Button variant="primary" size="sm" icon="git-branch" disabled={!host} onClick={() => setView('sync')}>
          Sync
        </Button>
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
          <div role="toolbar" aria-label="Pane options" style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 0' }}>
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

          <div style={{ flex: '1 1 auto', minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 32px minmax(0, 1fr)', gap: 8, padding: '12px 16px 16px' }}>
            <FilePane side="local" host={host} conn={conn} ref={localRef} onScroll={onScroll('local')} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <button type="button" className="xfer" disabled={!connected || !localSel} aria-label={`Upload selected to ${host.name}`} title={`Upload selected to remote (${ALT}${MOD}↑)`} onClick={() => void uploadSelection('local')}>
                »
              </button>
              <button type="button" className="xfer" disabled={!connected || !remoteSel} aria-label={`Download selected from ${host.name}`} title={`Download selected to local (${ALT}${MOD}↓)`} onClick={() => void downloadSelection('remote')}>
                «
              </button>
            </div>
            <FilePane side="remote" host={host} conn={conn} ref={remoteRef} onScroll={onScroll('remote')} />
          </div>

          <TransfersPanel />
        </>
      )}

      <footer className="app-footer">
        {host ? (
          <>
            <span>
              {host.protocol.toUpperCase()}
              {conn.info.serverVersion ? ` · ${conn.info.serverVersion}` : ''}
              {conn.info.cipher ? ` · ${conn.info.cipher}` : ''}
            </span>
            <span title={mapping ? `${mapping.local} → ${mapping.remote}` : undefined}>Mapping: {mapping ? `${mapping.local} → ${mapping.remote}` : `${localRoot} → ${remoteRoot || '(home)'}`}</span>
            <span>Auto-upload on save: {host.behavior.uploadOnSave ? 'On' : 'Off'}</span>
          </>
        ) : (
          <span>{project?.localRoot}</span>
        )}
        <span className="spacer" />
        <span>
          <Icon name="git-branch" size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
          {lastDone ? `Last transfer ${formatAgo(lastDone)}` : 'No transfers yet'}
        </span>
      </footer>
    </>
  )
}
