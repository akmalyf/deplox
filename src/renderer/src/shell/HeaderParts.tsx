import { useState, type ReactNode } from 'react'
import { Button, Icon, Kbd, MenuItem, MenuPopover, StatusDot } from '@/ds'
import type { Host, HostConn } from '@shared/types'
import { initials } from '@shared/format'
import { useApp, useActiveHost, useActiveProject, useProjectHosts } from '../stores/app'
import { useUi } from '../stores/ui'
import { hostAddress, selectHost } from '../lib/actions'
import { invoke } from '../lib/ipc'
import { MOD } from '../lib/ipc'

export function Sep() {
  return <Icon name="chevron-right" className="crumb-sep" />
}

export function Header({ children }: { children?: ReactNode }) {
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const toggle = useUi((s) => s.toggleSidebar)
  return (
    <header className="app-header drag">
      <HeaderReveal shown={collapsed}>
        <Button variant="ghost" size="sm" icon="sidebar" iconOnly onClick={toggle} title={`Show sidebar (${MOD}B)`}>
          Show sidebar
        </Button>
      </HeaderReveal>
      {children}
    </header>
  )
}

/**
 * Header items that stand in for the sidebar while it is hidden. They stay mounted and grow/fade in step with
 * the sidebar's slide (see .header-reveal), instead of popping in and out.
 */
function HeaderReveal({ shown, children }: { shown: boolean; children: ReactNode }) {
  return (
    <div className="header-reveal" aria-hidden={!shown} inert={!shown}>
      <div>{children}</div>
    </div>
  )
}

/** Project switcher in a view header: only while the sidebar (where it normally lives) is hidden. */
export function ProjectCrumb() {
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const project = useActiveProject()
  if (!project) return null
  return (
    <HeaderReveal shown={collapsed}>
      <ProjectSwitch />
      <Sep />
    </HeaderReveal>
  )
}

export function ProjectSwitch({ variant = 'header' }: { variant?: 'header' | 'sidebar' }) {
  const project = useActiveProject()
  const projects = useApp((s) => s.projects)
  const hosts = useApp((s) => s.hosts)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const openDialog = useUi((s) => s.openProjectDialog)
  if (!project) return null
  const sorted = [...projects].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
  return (
    <>
      <button
        type="button"
        className={variant === 'sidebar' ? 'proj-switch proj-switch-sidebar' : 'proj-switch'}
        aria-haspopup="menu"
        aria-expanded={menu ? 'true' : 'false'}
        aria-label={`Switch project, current: ${project.name}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu(menu ? null : { x: r.left, y: r.bottom + 4 })
        }}
      >
        <span className="proj-avatar" style={{ background: project.color }} aria-hidden="true">
          {initials(project.name)}
        </span>
        <span className="ell">{project.name}</span>
        <Icon name="chevron-down" style={{ color: 'var(--ink-subtle)', flex: '0 0 auto' }} />
      </button>
      {menu ? (
        <MenuPopover x={menu.x} y={menu.y} width={300} label="Switch project" onClose={() => setMenu(null)}>
          <div style={{ padding: '4px 8px 6px', fontSize: 12, lineHeight: '16px', color: 'var(--ink-subtle)' }}>Recent projects</div>
          {sorted.slice(0, 8).map((p, i) => {
            const n = hosts.filter((h) => h.projectId === p.id).length
            const current = p.id === project.id
            return (
              <button
                key={p.id}
                type="button"
                role="menuitem"
                className={current ? 'proj-row proj-row-current' : 'proj-row'}
                onClick={() => void invoke('projects:open', p.id).then((settings) => useApp.setState({ settings }))}
              >
                <span className="proj-avatar" style={{ background: p.color, width: 28, height: 28, borderRadius: 6, fontSize: 12 }} aria-hidden="true">
                  {initials(p.name)}
                </span>
                <span style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span className="ell" style={{ fontWeight: 500 }}>
                    {p.name}
                  </span>
                  <span className="ell" style={{ fontSize: 11, lineHeight: '14px', color: 'var(--ink-subtle)' }}>
                    {p.localRoot} · {n} host{n === 1 ? '' : 's'}
                  </span>
                </span>
                {current ? <Icon name="check" label="Current project" /> : i < 9 ? <Kbd>{`⌃${i + 1}`}</Kbd> : null}
              </button>
            )
          })}
          <MenuItem separator />
          <MenuItem icon="plus" onClick={() => openDialog({ mode: 'new' })}>
            New Project…
          </MenuItem>
          <MenuItem icon="pencil" onClick={() => openDialog({ mode: 'edit', projectId: project.id })}>
            Edit Project…
          </MenuItem>
        </MenuPopover>
      ) : null}
    </>
  )
}

export function connLabel(c: HostConn): { status: 'success' | 'warning' | 'danger' | 'neutral'; text: string } {
  switch (c.state) {
    case 'connected':
      return { status: 'success', text: 'Connected' }
    case 'connecting':
    case 'authenticating':
      return { status: 'neutral', text: 'Connecting…' }
    case 'verifying':
      return { status: 'warning', text: 'Verifying host key' }
    case 'reconnecting':
      return { status: 'warning', text: `Reconnecting · attempt ${c.attempt} of ${c.maxAttempts}` }
    case 'auth-failed':
      return { status: 'warning', text: 'Needs password' }
    case 'error':
      return { status: 'danger', text: 'Connection failed' }
    default:
      return { status: 'neutral', text: 'Disconnected' }
  }
}

export function HostCrumb({ host }: { host: Host }) {
  const hosts = useProjectHosts()
  const conns = useApp((s) => s.conns)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <button
        type="button"
        className="crumb"
        aria-haspopup="menu"
        aria-expanded={menu ? 'true' : 'false'}
        aria-label={`Switch host, current: ${host.name}`}
        title={hostAddress(host)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu(menu ? null : { x: r.left, y: r.bottom + 4 })
        }}
      >
        <Icon name={host.protocol === 'ftp' ? 'globe' : 'lock'} />
        {host.name}
        <Icon name="chevron-down" style={{ color: 'var(--ink-subtle)' }} />
      </button>
      {menu ? (
        <MenuPopover x={menu.x} y={menu.y} width={260} label="Switch host" onClose={() => setMenu(null)}>
          {hosts.map((h) => {
            const c = conns[h.id]
            const l = connLabel(c ?? { hostId: h.id, state: 'disconnected', attempt: 0, maxAttempts: 5, info: {} })
            return (
              <button key={h.id} type="button" role="menuitem" className="ad-menu-item" onClick={() => void selectHost(h.id)}>
                <StatusDot status={l.status} label={l.text} />
                <span className="ad-menu-item-label">{h.name}</span>
                {h.id === host.id ? <Icon name="check" label="Current host" /> : <Kbd>{h.protocol.toUpperCase()}</Kbd>}
              </button>
            )
          })}
        </MenuPopover>
      ) : null}
    </>
  )
}

export function PaletteTrigger() {
  const setPalette = useUi((s) => s.setPalette)
  return (
    <button type="button" className="pal-trigger" aria-haspopup="dialog" aria-label="Search files, hosts and actions" onClick={() => setPalette(true)}>
      <Icon name="search" />
      <span style={{ flex: '1 1 auto' }} className="ell">
        Search or run…
      </span>
      <Kbd>{`${MOD}K`}</Kbd>
    </button>
  )
}

/** Project › host crumbs shared by every view header. */
export function Crumbs({ children }: { children?: ReactNode }) {
  const host = useActiveHost()
  return (
    <>
      <ProjectCrumb />
      {host ? <HostCrumb host={host} /> : null}
      {children}
    </>
  )
}
