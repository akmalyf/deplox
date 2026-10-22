import { useState } from 'react'
import { Button, Icon, Kbd, MenuItem, MenuPopover, NavGroup, NavItem, SectionLabel, Sidebar, StatusDot } from '@/ds'
import type { Host } from '@shared/types'
import { useApp, useActiveHost, useActiveProject, useProjectHosts } from '../stores/app'
import { useUi, type View } from '../stores/ui'
import { invoke, isMac, MOD } from '../lib/ipc'
import { copyText, connectHost, hostAddress, selectHost } from '../lib/actions'
import { connLabel, ProjectSwitch } from './HeaderParts'
import { toast } from '../stores/ui'

const ICON: Record<Host['protocol'], string> = { sftp: 'database', ftps: 'cloud', ftp: 'box' }

export function HostSidebar() {
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const editHost = useUi((s) => s.editHost)
  const editHostId = useUi((s) => s.editHostId)
  const toggleSidebar = useUi((s) => s.toggleSidebar)
  const project = useActiveProject()
  const hosts = useProjectHosts()
  const active = useActiveHost()
  const conns = useApp((s) => s.conns)
  const userName = useApp((s) => s.home.split(/[\\/]/).filter(Boolean).pop() ?? 'You')
  const [menu, setMenu] = useState<{ host: Host; x: number; y: number } | null>(null)

  // Shortcut chips only show while the modifier key is held; a badge (pending count) stays visible otherwise.
  const nav = (v: View, label: string, icon: string, shortcut: string, badge?: string) => (
    <NavItem
      icon={icon}
      selected={view === v}
      title={`${label} (${shortcut})`}
      trailing={
        <>
          <Kbd className="shortcut-hint">{shortcut}</Kbd>
          {badge ? <Kbd className="shortcut-badge">{badge}</Kbd> : null}
        </>
      }
      onClick={() => setView(v)}
    >
      {label}
    </NavItem>
  )

  const remove = (h: Host) =>
    useUi.getState().askConfirm({
      title: `Remove ${h.name}?`,
      description: 'The host, its saved password and pending transfers are removed from this project. Files stay untouched.',
      confirm: 'Remove Host',
      danger: true,
      run: async () => {
        await invoke('hosts:delete', h.id)
        toast(`${h.name} removed from ${project?.name ?? 'project'}`)
      }
    })

  return (
    <Sidebar
      label="Hosts"
      account={{ name: userName, onSettings: () => setView('settings') }}
    >
      <div className={isMac ? 'sb-top sb-top-mac drag' : 'sb-top drag'}>
        <span className="spacer" />
        <Button variant="ghost" size="sm" icon="sidebar" iconOnly onClick={toggleSidebar}>
          Toggle sidebar
        </Button>
      </div>
      <div style={{ padding: '0 12px' }}>
        <ProjectSwitch variant="sidebar" />
      </div>
      <NavGroup label="Workspace">
        {nav('browser', 'Remote Browser', 'cloud', `${MOD}1`)}
        {nav('terminal', 'SSH Sessions', 'terminal', `${MOD}2`)}
      </NavGroup>
      {project ? (
        <div>
          <SectionLabel variant="sidebar">Hosts · {project.name}</SectionLabel>
          <NavGroup label="Hosts">
            {hosts.map((h) => {
              const c = conns[h.id]
              const l = connLabel(c ?? { hostId: h.id, state: 'disconnected', attempt: 0, maxAttempts: 5, info: {} })
              const selected = view === 'host' ? editHostId === h.id : active?.id === h.id
              const open = menu?.host.id === h.id
              return (
                <div key={h.id} className={open ? 'host-row host-row-open' : 'host-row'}>
                  <button
                    type="button"
                    className={selected ? 'ad-nav-item ad-nav-item-selected' : 'ad-nav-item'}
                    aria-current={selected ? 'page' : undefined}
                    title={`${hostAddress(h)} · ${l.text}`}
                    onClick={() => {
                      void selectHost(h.id)
                      if (view === 'host' || view === 'settings' || view === 'welcome') setView('browser')
                    }}
                    onDoubleClick={() => void connectHost(h.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ host: h, x: e.clientX, y: e.clientY })
                    }}
                  >
                    <Icon name={ICON[h.protocol]} />
                    <span className="ad-nav-label">{h.name}</span>
                    <StatusDot status={l.status} label={l.text} />
                    <span className="ad-nav-trailing">
                      <Kbd>{h.protocol.toUpperCase()}</Kbd>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="host-more"
                    aria-label={`More actions for ${h.name}`}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect()
                      setMenu(open ? null : { host: h, x: r.right - 24, y: r.bottom + 4 })
                    }}
                  >
                    <Icon name="dots" />
                  </button>
                </div>
              )
            })}
            <NavItem icon="plus" selected={view === 'host' && editHostId === 'new'} onClick={() => editHost('new')}>
              Add Host
            </NavItem>
          </NavGroup>
        </div>
      ) : null}

      {menu ? (
        <MenuPopover x={menu.x} y={menu.y} width={240} label="Host actions" onClose={() => setMenu(null)}>
          <div style={{ padding: '4px 8px 6px', fontSize: 12, lineHeight: '16px', color: 'var(--ink-subtle)' }}>
            {menu.host.name} · {menu.host.protocol.toUpperCase()}
          </div>
          <MenuItem icon="pencil" shortcut="E" onClick={() => editHost(menu.host.id)}>
            Edit Host…
          </MenuItem>
          <MenuItem icon="copy" shortcut="C" onClick={() => void copyText(hostAddress(menu.host), 'Address')}>
            Copy Address
          </MenuItem>
          <MenuItem
            icon="fork"
            shortcut="D"
            onClick={() =>
              void invoke('hosts:duplicate', menu.host.id).then(() => toast(`${menu.host.name} duplicated`))
            }
          >
            Duplicate
          </MenuItem>
          <MenuItem separator />
          {conns[menu.host.id]?.state === 'connected' || conns[menu.host.id]?.state === 'reconnecting' ? (
            <MenuItem icon="logout" onClick={() => void invoke('hosts:disconnect', menu.host.id)}>
              Disconnect
            </MenuItem>
          ) : (
            <MenuItem icon="logout" onClick={() => void connectHost(menu.host.id)}>
              Connect
            </MenuItem>
          )}
          <MenuItem icon="x" danger shortcut="⌫" onClick={() => remove(menu.host)}>
            Remove Host
          </MenuItem>
        </MenuPopover>
      ) : null}
    </Sidebar>
  )
}
