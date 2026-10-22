import { forwardRef, useMemo, useState, type UIEvent } from 'react'
import { Button, Chip, FileTree, Icon, MenuItem, MenuPopover, SearchInput, type FileNode } from '@/ds'
import type { Host, HostConn } from '@shared/types'
import { useBrowser, counterpart, type Side } from '../../stores/browser'
import { useSync } from '../../stores/sync'
import { ALT, MOD, invoke } from '../../lib/ipc'
import { copyText, syncSelection, hostRoots, deletePaths, downloadSelection, newFolder, openLocalTerminal, openSsh, renamePath, uploadSelection } from '../../lib/actions'
import { buildTree, conflictPaths } from './tree'
import { Disconnected, LoadingSkeleton, NoMapping, ReconnectBanner, SignInFailed } from './PaneStates'
import { useUi } from '../../stores/ui'

interface Props {
  side: Side
  host: Host | undefined
  conn: HostConn
  onScroll?: (e: UIEvent<HTMLDivElement>) => void
}

export const FilePane = forwardRef<HTMLDivElement, Props>(function FilePane({ side, host, conn, onScroll }, scrollRef) {
  const pane = useBrowser((s) => s[side])
  const other = useBrowser((s) => (side === 'local' ? s.remote : s.local))
  const localRoot = useBrowser((s) => s.local.root)
  const remoteRoot = useBrowser((s) => s.remote.root)
  const diffOnly = useBrowser((s) => s.diffOnly)
  const select = useBrowser((s) => s.select)
  const toggle = useBrowser((s) => s.toggle)
  const setFilter = useBrowser((s) => s.setFilter)
  const setChip = useBrowser((s) => s.setChip)
  const refresh = useBrowser((s) => s.refresh)
  const setRoot = useBrowser((s) => s.setRoot)
  const syncItems = useSync((s) => s.items)
  const [menu, setMenu] = useState<{ x: number; y: number; node: FileNode | null } | null>(null)
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number } | null>(null)

  const conflicts = useMemo(() => conflictPaths(syncItems, host?.id), [syncItems, host?.id])
  const tree = useMemo(
    () => buildTree({ side, pane, other, localRoot, remoteRoot, host, conflicts, diffOnly }),
    [side, pane, other, localRoot, remoteRoot, host, conflicts, diffOnly]
  )

  const isRemote = side === 'remote'
  const label = isRemote ? 'Remote' : 'Local'
  const pathLabel = isRemote ? (host ? `${host.name}:${pane.root || '…'}` : '') : pane.root
  const rootError = pane.errors[pane.root]
  const rootLoading = !!pane.loading[pane.root] && !pane.entries[pane.root]

  const openMenu = (x: number, y: number, node: FileNode | null) => {
    if (node && !pane.selected.has(node.path)) select(side, node.path, { shift: false, meta: false }, tree.order)
    setMenu({ x, y, node })
  }

  const selection = () => (pane.selected.size ? [...pane.selected] : menu?.node ? [menu.node.path] : [])

  let body
  if (isRemote && host && !host.mappings.length && !pane.root && conn.state === 'connected') {
    body = <NoMapping host={host} />
  } else if (isRemote && host && conn.state === 'auth-failed') {
    body = <SignInFailed host={host} conn={conn} />
  } else if (isRemote && host && !pane.entries[pane.root] && (conn.state === 'disconnected' || conn.state === 'error')) {
    body = <Disconnected host={host} conn={conn} />
  } else if (isRemote && !pane.entries[pane.root] && (conn.state === 'connecting' || conn.state === 'authenticating' || conn.state === 'verifying' || rootLoading)) {
    body = <LoadingSkeleton label={conn.state === 'verifying' ? 'Waiting for host key verification…' : conn.state === 'connected' ? `Listing ${pane.root}…` : `Connecting to ${host?.name ?? 'host'}…`} onCancel={host ? () => void invoke('hosts:disconnect', host.id) : undefined} />
  } else if (!isRemote && rootLoading) {
    body = <LoadingSkeleton label={`Listing ${pane.root}…`} />
  } else if (rootError && !pane.entries[pane.root]) {
    body = (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--danger)' }}>{rootError}</span>
        <Button size="sm" onClick={() => void refresh(side)}>
          Retry
        </Button>
      </div>
    )
  } else {
    const stale = isRemote && conn.state !== 'connected'
    body = (
      <>
        {isRemote && host && conn.state === 'reconnecting' ? <ReconnectBanner host={host} conn={conn} /> : null}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', opacity: stale ? 0.45 : 1 }}
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest('[role="treeitem"]')) return
            e.preventDefault()
            openMenu(e.clientX, e.clientY, null)
          }}
        >
          <FileTree
            label={`${label} files`}
            width="100%"
            fileIcons="typed"
            nodes={tree.nodes}
            selected={pane.selected}
            focused={pane.focused}
            onSelect={(path, _n, m) => select(side, path, m, tree.order)}
            onToggle={(path, _n, open) => toggle(side, path, open)}
            onOpen={(path) => {
              select(side, path, { shift: false, meta: false }, tree.order)
              syncSelection(side)
            }}
            onContextMenu={(_p, node, e) => openMenu(e.clientX, e.clientY, node)}
            empty={
              <div style={{ padding: '8px 16px', color: 'var(--ink-subtle)' }}>
                {pane.filter || pane.chip !== 'all' || diffOnly ? 'Nothing matches the filter' : 'This folder is empty'}
              </div>
            }
          />
        </div>
        {stale && pane.loadedAt ? (
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--line)', fontSize: 11, lineHeight: '14px', color: 'var(--ink-subtle)' }}>
            Cached listing from {new Date(pane.loadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · read-only until reconnected
          </div>
        ) : null}
      </>
    )
  }

  const node = menu?.node
  const isDir = node?.type === 'folder'
  const cp = node ? counterpart(side, node.path, localRoot, remoteRoot) : null

  return (
    <section aria-label={`${label} files`} style={{ background: 'var(--bg-card)', borderRadius: 10, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }} onFocus={() => useBrowser.getState().setActiveSide(side)}>
      <div style={{ height: 44, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 16px', borderBottom: '1px solid var(--line)' }}>
        <Icon name={isRemote ? 'cloud' : 'laptop'} />
        <span style={{ fontWeight: 500 }}>{label}</span>
        <button
          type="button"
          className="crumb-path"
          style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left' }}
          title={`${pathLabel} · click to go to another folder`}
          onClick={() =>
            useUi.getState().askInput({
              title: isRemote ? `Go to folder on ${host?.name ?? 'server'}` : 'Go to local folder',
              label: 'Absolute path',
              value: pane.root,
              mono: true,
              confirm: 'Go',
              validate: (v) => (!v.trim() ? 'Enter a path' : null),
              run: (v) => setRoot(side, v.trim().replace(/(.)\/+$/, '$1'))
            })
          }
        >
          {pathLabel}
        </button>
        <span className="spacer" />
        <Button variant="ghost" size="sm" icon="folder-plus" iconOnly disabled={isRemote && conn.state !== 'connected'} onClick={() => newFolder(side)}>
          New folder
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon="dots"
          iconOnly
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setPaneMenu({ x: r.right - 220, y: r.bottom + 4 })
          }}
        >
          More
        </Button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
        <SearchInput placeholder={`Filter ${label.toLowerCase()} files`} width={200} value={pane.filter} onValueChange={(v) => setFilter(side, v)} />
        <Chip selected={pane.chip === 'all'} onClick={() => setChip(side, 'all')}>
          All
        </Chip>
        <Chip selected={pane.chip === 'changed'} onClick={() => setChip(side, pane.chip === 'changed' ? 'all' : 'changed')}>
          Changed · {tree.counts.changed}
        </Chip>
        <Chip selected={pane.chip === 'only'} onClick={() => setChip(side, pane.chip === 'only' ? 'all' : 'only')}>
          {isRemote ? 'Remote only' : 'Local only'} · {tree.counts.only}
        </Chip>
      </div>
      {body}

      {menu ? (
        <MenuPopover x={menu.x} y={menu.y} width={248} label={`${label} file actions`} onClose={() => setMenu(null)}>
          {node ? (
            <>
              <MenuItem icon="git-branch" shortcut={`${MOD}D`} disabled={!cp || conn.state !== 'connected'} onClick={() => syncSelection(side)}>
                {isDir ? 'Sync Folder…' : 'Sync File…'}
              </MenuItem>
              <MenuItem icon="arrow-down" shortcut={`${ALT}${MOD}↓`} disabled={!cp || conn.state !== 'connected'} onClick={() => void downloadSelection(side)}>
                Download to Local
              </MenuItem>
              <MenuItem icon="arrow-up-right" shortcut={`${ALT}${MOD}↑`} disabled={!cp || conn.state !== 'connected'} onClick={() => void uploadSelection(side)}>
                Upload {isRemote ? 'from Local' : 'to Server'}
              </MenuItem>
              {isRemote ? (
                <MenuItem icon="terminal" disabled={host?.protocol !== 'sftp'} onClick={() => void openSsh(host?.id, isDir ? node.path : node.path.slice(0, node.path.lastIndexOf('/')) || '/')}>
                  Open in SSH Terminal
                </MenuItem>
              ) : (
                <>
                  <MenuItem icon="terminal" onClick={() => void openLocalTerminal(isDir ? node.path : node.path.replace(/[\\/][^\\/]+$/, ''))}>
                    Open in Terminal
                  </MenuItem>
                  <MenuItem icon="folder-open" onClick={() => void invoke('app:revealPath', node.path)}>
                    Reveal in Finder
                  </MenuItem>
                </>
              )}
              <MenuItem icon="file-text" onClick={() => void copyText(node.path, isRemote ? 'Remote path' : 'Path')}>
                Copy {isRemote ? 'Remote ' : ''}Path
              </MenuItem>
              <MenuItem icon="pencil" disabled={isRemote && conn.state !== 'connected'} onClick={() => renamePath(side, node.path)}>
                Rename…
              </MenuItem>
              <MenuItem icon="folder-plus" disabled={isRemote && conn.state !== 'connected'} onClick={() => newFolder(side)}>
                New Folder…
              </MenuItem>
              <MenuItem separator />
              <MenuItem icon="x" danger disabled={isRemote && conn.state !== 'connected'} onClick={() => deletePaths(side, selection())}>
                {isRemote ? 'Delete from Server…' : 'Move to Trash…'}
              </MenuItem>
            </>
          ) : (
            <>
              <MenuItem icon="folder-plus" onClick={() => newFolder(side)}>
                New Folder…
              </MenuItem>
              <MenuItem icon="refresh" onClick={() => void refresh(side)}>
                Refresh
              </MenuItem>
            </>
          )}
        </MenuPopover>
      ) : null}

      {paneMenu ? (
        <MenuPopover x={paneMenu.x} y={paneMenu.y} width={220} label={`${label} pane`} onClose={() => setPaneMenu(null)}>
          <MenuItem icon="refresh" onClick={() => void refresh(side)}>
            Refresh
          </MenuItem>
          <MenuItem
            icon="minus"
            onClick={() => useBrowser.setState((s) => ({ [side]: { ...s[side], expanded: { [s[side].root]: true } } }))}
          >
            Collapse All
          </MenuItem>
          <MenuItem icon="file-text" onClick={() => void copyText(pane.root, 'Path')}>
            Copy Folder Path
          </MenuItem>
          {!isRemote ? (
            <MenuItem icon="folder-open" onClick={() => void invoke('app:revealPath', pane.root)}>
              Reveal in Finder
            </MenuItem>
          ) : null}
          {host?.mappings[0] ? (
            <MenuItem
              icon="home"
              onClick={() => setRoot(side, isRemote ? hostRoots(host, undefined).remote : hostRoots(host, undefined).local)}
            >
              Go to Mapping Root
            </MenuItem>
          ) : null}
        </MenuPopover>
      ) : null}
    </section>
  )
})
