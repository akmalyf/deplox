import { useEffect, useState } from 'react'
import { Button, EmptyState, MenuItem, MenuPopover, RightPanel, StatusDot, ToolPanel } from '@/ds'
import { formatDuration } from '@shared/format'
import { useTerminal, type TermSession } from '../../stores/terminal'
import { useApp, useActiveHost, useActiveProject, useProjectHosts } from '../../stores/app'
import { useUi, toast } from '../../stores/ui'
import { useBrowser } from '../../stores/browser'
import { invoke } from '../../lib/ipc'
import { openLocalTerminal, openSsh, selectHost } from '../../lib/actions'
import { Crumbs, Header, ProjectCrumb, Sep } from '../../shell/HeaderParts'
import { XtermPane } from './XtermPane'

function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(i)
  }, [ms])
  return now
}

function SessionTimer({ s }: { s: TermSession }) {
  const now = useNow(1000)
  return <>{s.exited ? 'Session ended' : `Session ${formatDuration(now - s.info.startedAt)}`}</>
}

export function TerminalView({ visible }: { visible: boolean }) {
  const sessions = useTerminal((s) => s.sessions)
  const activeId = useTerminal((s) => s.activeId)
  const setActive = useTerminal((s) => s.setActive)
  const remove = useTerminal((s) => s.remove)
  const snippets = useApp((s) => s.snippets)
  const hosts = useProjectHosts()
  const host = useActiveHost()
  const project = useActiveProject()
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null)
  const [more, setMore] = useState<{ x: number; y: number } | null>(null)
  const active = sessions.find((s) => s.id === activeId) ?? sessions[0]

  const close = (id: string) => {
    void invoke('terminal:close', id)
    remove(id)
  }

  const reopen = (s: TermSession) => {
    close(s.id)
    if (s.info.kind === 'ssh') void openSsh(s.info.hostId)
    else void openLocalTerminal(s.info.cwd)
  }

  // Snippets run with Enter, so confirm first: a misclick could restart a queue or clear caches on a live server.
  const send = (cmd: string) => {
    if (!active || active.exited) return toast('Open a session first')
    const session = active
    useUi.getState().askConfirm({
      title: `Run this command in ${session.info.title}?`,
      description: session.info.kind === 'ssh' ? 'It runs on the server right away.' : 'It runs in this local shell right away.',
      detail: cmd,
      confirm: 'Run',
      run: () => window.deplox.send('terminal:write', { sessionId: session.id, data: cmd + '\r' })
    })
  }

  const addSnippet = () =>
    useUi.getState().askInput({
      title: 'Add snippet',
      label: 'Command',
      mono: true,
      confirm: 'Add',
      validate: (v) => (!v.trim() ? 'Enter a command' : null),
      run: async (v) => {
        const list = [...snippets, { id: `sn_${Date.now()}`, label: v.trim(), command: v.trim() }]
        await invoke('snippets:save', list)
      }
    })

  const info = active?.info
  const infoRows: [string, string][] = info
    ? info.kind === 'ssh'
      ? [
          ['Host', `${info.host}:${info.port}`],
          ['User', info.user ?? ''],
          ['Auth', info.auth ?? ''],
          ['Cipher', info.cipher ?? '—'],
          ['Latency', info.latencyMs != null ? `${info.latencyMs} ms` : '—'],
          ['Size', `${info.cols}×${info.rows}`]
        ]
      : [
          ['Shell', info.shell ?? ''],
          ['Folder', info.cwd ?? ''],
          ['Size', `${info.cols}×${info.rows}`]
        ]
    : []

  const sshHost = info?.kind === 'ssh' ? hosts.find((h) => h.id === info.hostId) : undefined

  if (!visible && !sessions.length) return null

  return (
    <div style={{ display: visible ? 'flex' : 'none', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
      <Header>
        {info?.kind === 'ssh' && sshHost ? (
          <Crumbs />
        ) : (
          <>
            <ProjectCrumb />
            <span style={{ color: 'var(--ink)', padding: '0 8px', whiteSpace: 'nowrap' }}>{info ? 'Local terminal' : 'Terminal'}</span>
          </>
        )}
        {info ? (
          <>
            <Sep />
            <span className="crumb-path">{info.kind === 'ssh' ? info.title : info.cwd}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8, fontSize: 12, whiteSpace: 'nowrap' }}>
              <StatusDot status={active?.exited ? 'neutral' : 'success'} label={active?.exited ? 'Ended' : 'Connected'} />
              {active ? <SessionTimer s={active} /> : null}
            </span>
          </>
        ) : null}
        <span className="spacer" />
        {info?.kind === 'ssh' && sshHost ? (
          <Button
            variant="ghost"
            size="sm"
            icon="folder-open"
            onClick={() => {
              void selectHost(sshHost.id)
              useUi.getState().setView('browser')
              useBrowser.getState().setActiveSide('remote')
            }}
          >
            Open in Browser
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" icon="terminal" onClick={() => void openLocalTerminal()}>
          Local tab
        </Button>
        {active ? (
          <Button variant="outline" size="sm" icon="x" onClick={() => close(active.id)}>
            {active.info.kind === 'ssh' ? 'Disconnect' : 'Close'}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          icon="dots"
          iconOnly
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setMore({ x: r.right - 220, y: r.bottom + 4 })
          }}
        >
          More
        </Button>
      </Header>

      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0, padding: '8px 12px 12px', display: 'flex', flexDirection: 'column' }}>
          {sessions.length ? (
            <ToolPanel
              label="Terminal sessions"
              tabs={sessions.map((s) => ({ id: s.id, icon: s.info.kind === 'ssh' ? 'terminal' : 'laptop', label: s.exited ? `${s.info.title} (ended)` : s.info.title, closable: true }))}
              activeId={active?.id}
              title={info ? `${info.kind === 'ssh' ? info.title : info.cwd} — ${info.cols}×${info.rows} — UTF-8` : ''}
              onSelect={setActive}
              onClose={close}
              onAdd={() => {
                const el = document.querySelector('.ad-toolpanel-tabs [aria-label="New session"]')
                const r = el?.getBoundingClientRect()
                setAddMenu({ x: r?.left ?? 400, y: (r?.bottom ?? 120) + 4 })
              }}
              addLabel="New session"
              width="100%"
              height="100%"
            >
              <div style={{ position: 'relative', height: '100%', background: 'var(--bg-pane)' }}>
                {sessions.map((s) => (
                  <XtermPane key={s.id} sessionId={s.id} active={visible && s.id === active?.id} />
                ))}
                {active?.exited ? (
                  <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: 'var(--bg-popover)', boxShadow: 'var(--shadow-popover)' }}>
                    <StatusDot status={active.exited.reason === 'Connection lost' ? 'warning' : 'neutral'} label="Ended" />
                    <span className="muted">
                      {active.exited.reason === 'Connection lost' ? 'Connection lost.' : `Session ended${active.exited.code != null ? ` with code ${active.exited.code}` : ''}.`}
                    </span>
                    <span className="spacer" />
                    <Button size="sm" onClick={() => reopen(active)}>
                      Reopen
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => close(active.id)}>
                      Close tab
                    </Button>
                  </div>
                ) : null}
              </div>
            </ToolPanel>
          ) : (
            <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState
                align="center"
                title="No terminal sessions"
                description={host?.protocol === 'sftp' ? `Open a shell on ${host.name} over SSH, or a local shell in ${project?.name ?? 'your project'}` : 'SSH sessions need an SFTP host. You can still open a local shell.'}
                actions={
                  <>
                    {host?.protocol === 'sftp' ? (
                      <Button variant="primary" icon="terminal" onClick={() => void openSsh(host.id)}>
                        SSH to {host.name}
                      </Button>
                    ) : null}
                    <Button icon="laptop" onClick={() => void openLocalTerminal()}>
                      Local terminal
                    </Button>
                  </>
                }
              />
            </div>
          )}
        </div>

        <RightPanel
          label="Session tools"
          width={280}
          groups={[
            {
              title: 'Snippets',
              items: [
                ...snippets.map((s) => ({ icon: 'terminal', label: <span className="ell">{s.label}</span>, title: s.command, onClick: () => send(s.command) })),
                { icon: 'plus', label: 'Add snippet', onClick: addSnippet }
              ]
            }
          ]}
        >
          {infoRows.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <p style={{ color: 'var(--ink-subtle)', fontSize: 12, lineHeight: '16px', margin: '0 0 4px' }}>Connection</p>
              <div style={{ background: 'var(--bg-card)', borderRadius: 10, padding: '4px 0' }}>
                {infoRows.map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 12px', fontSize: 12, lineHeight: '16px' }}>
                    <span style={{ color: 'var(--ink-muted)' }}>{k}</span>
                    <span className="ell" style={{ color: 'var(--ink)', fontFamily: 'var(--font-mono)', textAlign: 'right' }} title={v}>
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </RightPanel>
      </div>

      {addMenu ? (
        <MenuPopover x={addMenu.x} y={addMenu.y} width={260} label="New session" onClose={() => setAddMenu(null)}>
          {hosts
            .filter((h) => h.protocol === 'sftp')
            .map((h) => (
              <MenuItem key={h.id} icon="terminal" onClick={() => void openSsh(h.id)}>
                SSH · {h.username}@{h.name}
              </MenuItem>
            ))}
          {hosts.some((h) => h.protocol === 'sftp') ? <MenuItem separator /> : null}
          <MenuItem icon="laptop" onClick={() => void openLocalTerminal()}>
            Local shell · {project?.name ?? 'home'}
          </MenuItem>
        </MenuPopover>
      ) : null}

      {more ? (
        <MenuPopover x={more.x} y={more.y} width={220} label="Terminal actions" onClose={() => setMore(null)}>
          <MenuItem icon="x" disabled={!active || !!active.exited} onClick={() => active && window.deplox.send('terminal:write', { sessionId: active.id, data: '\x0c' })}>
            Clear screen
          </MenuItem>
          <MenuItem icon="refresh" disabled={!active} onClick={() => active && reopen(active)}>
            Restart session
          </MenuItem>
          <MenuItem separator />
          <MenuItem icon="x" disabled={!sessions.length} onClick={() => sessions.forEach((s) => close(s.id))}>
            Close all sessions
          </MenuItem>
        </MenuPopover>
      ) : null}
    </div>
  )
}
