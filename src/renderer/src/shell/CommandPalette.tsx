import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, Kbd } from '@/ds'
import { basename } from '@shared/paths'
import { useApp, useActiveHost, useProjectHosts } from '../stores/app'
import { useUi } from '../stores/ui'
import { useBrowser } from '../stores/browser'
import { ALT, MOD } from '../lib/ipc'
import { downloadSelection, openFileSync, openLocalTerminal, openSsh, selectHost, syncAll, syncSelection, uploadSelection } from '../lib/actions'
import { counterpart } from '../stores/browser'

interface Item {
  id: string
  group: string
  icon: string
  label: string
  hint?: string
  keys?: string
  run: () => void
}

/** Subsequence match; lower is better, -1 = no match. */
function score(text: string, q: string): number {
  if (!q) return 0
  const t = text.toLowerCase()
  const s = q.toLowerCase()
  const direct = t.indexOf(s)
  if (direct >= 0) return direct
  let ti = 0
  let gaps = 0
  for (const ch of s) {
    const i = t.indexOf(ch, ti)
    if (i < 0) return -1
    gaps += i - ti
    ti = i + 1
  }
  return 100 + gaps
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  if (!open) return null
  return <Palette />
}

function Palette() {
  const setPalette = useUi((s) => s.setPalette)
  const setView = useUi((s) => s.setView)
  const editHost = useUi((s) => s.editHost)
  const host = useActiveHost()
  const hosts = useProjectHosts()
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const browser = useBrowser()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const close = () => setPalette(false)

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    const focused = browser[browser.activeSide].focused
    if (host && focused) {
      out.push({ id: 'sync-focused', group: 'Recent', icon: 'git-branch', label: `Sync ${basename(focused)}`, hint: `with ${host.name}`, keys: `${MOD}D`, run: () => syncSelection() })
    }
    if (host) {
      out.push(
        { id: 'up', group: 'Actions', icon: 'arrow-up-right', label: 'Upload selection', hint: `to ${host.name}`, keys: `${ALT}${MOD}↑`, run: () => void uploadSelection() },
        { id: 'down', group: 'Actions', icon: 'arrow-down', label: 'Download selection', hint: `from ${host.name}`, keys: `${ALT}${MOD}↓`, run: () => void downloadSelection() }
      )
    }
    if (host) out.push({ id: 'sync-all', group: 'Actions', icon: 'git-branch', label: 'Sync all…', hint: `with ${host.name}`, run: () => syncAll() })
    out.push(
      { id: 'local-term', group: 'Actions', icon: 'terminal', label: 'New local terminal', hint: 'Project folder', run: () => void openLocalTerminal() },
      { id: 'add-host', group: 'Actions', icon: 'plus', label: 'Add host…', run: () => editHost('new') },
      { id: 'new-project', group: 'Actions', icon: 'folder-plus', label: 'New project…', run: () => useUi.getState().openProjectDialog({ mode: 'new' }) },
      {
        id: 'theme',
        group: 'Actions',
        icon: settings.theme === 'light' ? 'moon' : 'sun',
        label: settings.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme',
        run: () => void updateSettings({ theme: settings.theme === 'light' ? 'dark' : 'light' })
      },
      { id: 'settings', group: 'Actions', icon: 'settings', label: 'Settings', keys: `${MOD},`, run: () => setView('settings') }
    )
    for (const h of hosts) {
      if (h.id !== host?.id) out.push({ id: `host-${h.id}`, group: 'Hosts', icon: 'cloud', label: `Switch to ${h.name}`, hint: `${h.protocol.toUpperCase()} · ${h.host}`, run: () => void selectHost(h.id) })
      if (h.protocol === 'sftp') out.push({ id: `ssh-${h.id}`, group: 'Hosts', icon: 'terminal', label: 'Open SSH session', hint: h.name, run: () => void openSsh(h.id) })
      out.push({ id: `edit-${h.id}`, group: 'Hosts', icon: 'pencil', label: `Edit ${h.name}…`, run: () => editHost(h.id) })
    }
    if (q.trim().length >= 2 && host) {
      const seen = new Set<string>()
      for (const side of ['local', 'remote'] as const) {
        for (const list of Object.values(browser[side].entries)) {
          for (const e of list) {
            if (e.type !== 'file' || seen.has(e.name + side) || score(e.name, q) < 0) continue
            seen.add(e.name + side)
            const cp = counterpart(side, e.path, browser.local.root, browser.remote.root)
            out.push({
              id: `file-${side}-${e.path}`,
              group: 'Files',
              icon: 'file-code',
              label: e.name,
              hint: `${side === 'local' ? 'Local' : host.name} · ${e.path}`,
              run: () => cp && openFileSync({ hostId: host.id, localPath: side === 'local' ? e.path : cp, remotePath: side === 'remote' ? e.path : cp })
            })
          }
        }
      }
    }
    return out
  }, [browser, host, hosts, q, settings.theme, setView, editHost, updateSettings])

  const filtered = useMemo(() => {
    const t = q.trim()
    if (!t) return items.filter((i) => i.group !== 'Files')
    return items
      .map((i) => ({ i, s: Math.min(...[score(i.label, t), i.hint ? score(i.hint, t) + 50 : -1].filter((x) => x >= 0).concat([Infinity])) }))
      .filter((x) => x.s !== Infinity)
      .sort((a, b) => a.s - b.s)
      .slice(0, 40)
      .map((x) => x.i)
  }, [items, q])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('.pal-row-active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const groups: { title: string; items: Item[] }[] = []
  for (const it of filtered) {
    let g = groups.find((x) => x.title === it.group)
    if (!g) groups.push((g = { title: it.group, items: [] }))
    g.items.push(it)
  }
  const flat = groups.flatMap((g) => g.items)

  const run = (it: Item | undefined) => {
    if (!it) return
    close()
    it.run()
  }

  return (
    <div onMouseDown={(e) => e.target === e.currentTarget && close()} style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'var(--scrim)', display: 'flex', justifyContent: 'center', paddingTop: 96 }}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" style={{ width: 640, maxWidth: 'calc(100% - 32px)', height: 'fit-content', maxHeight: 'calc(100% - 160px)', background: 'var(--bg-popover)', borderRadius: 14, boxShadow: 'var(--shadow-popover)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52, padding: '0 16px', borderBottom: '1px solid var(--line)', flex: '0 0 auto' }}>
          <Icon name="search" style={{ color: 'var(--ink-subtle)' }} />
          <input
            className="pal-input"
            type="text"
            placeholder="Search files, hosts and actions"
            aria-label="Search files, hosts and actions"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(flat.length - 1, a + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(0, a - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                run(flat[active])
              } else if (e.key === 'Escape') {
                e.preventDefault()
                close()
              }
            }}
          />
          <Kbd>esc</Kbd>
        </div>
        <div ref={listRef} style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 4, overflow: 'auto' }}>
          {groups.map((g) => (
            <div role="group" aria-label={g.title} key={g.title}>
              <div style={{ padding: '6px 10px 4px', fontSize: 12, lineHeight: '16px', color: 'var(--ink-subtle)' }}>{g.title}</div>
              {g.items.map((it) => {
                const idx = flat.indexOf(it)
                return (
                  <button key={it.id} type="button" className={idx === active ? 'pal-row pal-row-active' : 'pal-row'} onMouseMove={() => setActive(idx)} onClick={() => run(it)}>
                    <Icon name={it.icon} />
                    <span className="ell" style={{ flex: '0 1 auto' }}>
                      {it.label}
                    </span>
                    <span className="ell" style={{ flex: '1 1 auto', fontSize: 12, color: 'var(--ink-subtle)' }}>
                      {it.hint}
                    </span>
                    {it.keys ? <Kbd>{it.keys}</Kbd> : null}
                  </button>
                )
              })}
            </div>
          ))}
          {!flat.length ? <div style={{ padding: '12px 10px', color: 'var(--ink-subtle)' }}>Nothing matches “{q}”</div> : null}
        </div>
        <div style={{ height: 32, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 16, padding: '0 16px', borderTop: '1px solid var(--line)', fontSize: 11, lineHeight: '14px', color: 'var(--ink-subtle)' }}>
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>{MOD}K close</span>
        </div>
      </div>
    </div>
  )
}

