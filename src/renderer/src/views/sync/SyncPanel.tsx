import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Button, Icon, SearchInput, fileIcon } from '@/ds'
import type { SyncAction, SyncDiff, SyncStatus } from '@shared/types'
import { useApp } from '../../stores/app'
import { useCompare } from '../../stores/compare'
import { useSyncDialog } from '../../stores/syncDialog'
import { useUi } from '../../stores/ui'
import { DiffPanel } from './DiffPanel'

const ROW = 24
const OVERSCAN = 12
/** Height of the sticky column header inside the scrolling list. */
const HEAD = 28

const STATUS: Record<SyncStatus, string> = {
  'local-changed': 'Changed locally',
  'remote-changed': 'Changed on server',
  conflict: 'Changed on both',
  'local-only': 'Only local',
  'remote-only': 'Only on server'
}

const ACTION: Record<SyncAction, { icon: string; label: string; glyph: string }> = {
  upload: { icon: 'arrow-up-right', label: 'Upload to server', glyph: '→' },
  download: { icon: 'arrow-down', label: 'Download to local', glyph: '←' },
  skip: { icon: 'minus', label: 'Skip', glyph: '–' }
}


const dateFmt = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
const sizeFmt = new Intl.NumberFormat()

/** One side of a row, mirrored like a two-pane directory diff: name · size · date | date · size · name. */
function cells(x: SyncDiff['local'], r: SyncDiff, tone: string, side: 'local' | 'remote') {
  const name = x ? (
    <span key={`${side}-name`} className={`sync-cell sync-name sync-path-${tone}`} title={`${r.relPath} · ${tone === 'synced' ? 'In sync' : STATUS[r.status]}`}>
      <Icon name={fileIcon(r.relPath)} />
      <span className="ell">{r.relPath}</span>
    </span>
  ) : (
    <span key={`${side}-name`} className="sync-cell" />
  )
  const size = (
    <span key={`${side}-size`} className="sync-cell sync-meta num">
      {x ? sizeFmt.format(x.size) : ''}
    </span>
  )
  const date = (
    <span key={`${side}-date`} className="sync-cell sync-meta ell">
      {x ? dateFmt.format(x.mtime) : ''}
    </span>
  )
  return side === 'local' ? [name, size, date] : [date, size, name]
}

/** Directory compare between local and server: pick a direction per file, review its lines below, then synchronize. */
export function SyncPanel({ onClose }: { onClose: () => void }) {
  const st = useSyncDialog()
  const host = useApp((s) => s.hosts.find((h) => h.id === st.hostId))
  const listRef = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ from: 0, to: 60 })

  const shown = useMemo(() => {
    const q = st.query.trim().toLowerCase()
    return q ? st.rows.filter((r) => r.relPath.toLowerCase().includes(q)) : st.rows
  }, [st.rows, st.query])
  const pending = st.rows.filter((r) => !st.resolved.has(r.remotePath))
  const ups = pending.filter((r) => (st.actions[r.remotePath] ?? r.action) === 'upload').length
  const downs = pending.filter((r) => (st.actions[r.remotePath] ?? r.action) === 'download').length
  const activeRow = pending.find((r) => r.remotePath === st.active)
  const activeReady = !!activeRow && (st.actions[activeRow.remotePath] ?? activeRow.action) !== 'skip'

  // A row whose diff turns identical after line merges has nothing left to sync.
  const pair = useCompare((s) => s.pair)
  const cmpLoading = useCompare((s) => s.loading)
  const cmpError = useCompare((s) => s.error)
  const hunks = useCompare((s) => s.hunks.length)
  const bothExist = useCompare((s) => !!s.local?.exists && !!s.remote?.exists)
  const { active, markResolved } = st
  useEffect(() => {
    if (pair && pair.remotePath === active && !cmpLoading && !cmpError && !hunks && bothExist) markResolved(pair.remotePath)
  }, [pair, active, cmpLoading, cmpError, hunks, bothExist, markResolved])

  const update = () => {
    const el = listRef.current
    if (!el) return
    const top = Math.max(0, el.scrollTop - HEAD)
    const from = Math.max(0, Math.floor(top / ROW) - OVERSCAN)
    const to = Math.min(shown.length, Math.ceil((top + el.clientHeight) / ROW) + OVERSCAN)
    setRange((r) => (r.from === from && r.to === to ? r : { from, to }))
  }
  useEffect(update, [shown.length])

  // Escape closes, unless an app dialog (host-key or password prompt) sits on top.
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      const ui = useUi.getState()
      if (e.key !== 'Escape' || ui.prompts.length || ui.confirm || ui.input || ui.paletteOpen) return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const move = (d: number) => {
    const i = shown.findIndex((r) => r.remotePath === st.active)
    const n = shown[Math.max(0, Math.min(shown.length - 1, i + d))]
    if (!n) return
    st.setActive(n.remotePath)
    const el = listRef.current
    const idx = shown.indexOf(n)
    if (el && (idx * ROW < el.scrollTop || (idx + 1) * ROW + HEAD > el.scrollTop + el.clientHeight)) el.scrollTop = Math.max(0, idx * ROW - el.clientHeight / 2)
  }

  const onListKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      move(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === ' ' && st.active) {
      e.preventDefault()
      st.cycle(st.active)
    }
  }

  const keys = shown.map((r) => r.remotePath)
  // Header toggle: cycles every listed file through upload → download → skip.
  // Files that can't take an action (e.g. download for a local-only file) keep theirs.
  const [lastBulk, setLastBulk] = useState<SyncAction | null>(null)
  const actOf = (r: SyncDiff) => st.actions[r.remotePath] ?? r.action
  const live = shown.filter((r) => !st.resolved.has(r.remotePath))
  const uniform = live.length && live.every((r) => actOf(r) === actOf(live[0])) ? actOf(live[0]) : null
  const nextBulk: SyncAction = { upload: 'download', download: 'skip', skip: 'upload' }[lastBulk ?? uniform ?? 'skip'] as SyncAction
  const bulkGlyph = uniform ?? 'mixed'
  const title = st.scope ? (st.scope.isDir ? 'Sync folder' : 'Sync file') : 'Sync all'
  // Roots compared on each side, shown above their half of the list.
  const mappings = host?.mappings.filter((m) => m.local.trim() && m.remote.trim()) ?? []
  const more = mappings.length > 1 ? ` (+${mappings.length - 1} more)` : ''
  const roots = st.scope
    ? { local: st.scope.localPath, remote: `${host?.name ?? 'server'}:${st.scope.remotePath}` }
    : { local: (mappings[0]?.local ?? '') + more, remote: `${host?.name ?? 'server'}:${mappings[0]?.remote ?? ''}${more}` }
  const scopeName = st.scope ? st.scope.localPath.split(/[\\/]/).pop() : null
  useEffect(() => {
    document.title = [title, host?.name, scopeName].filter(Boolean).join(' · ')
  }, [title, host?.name, scopeName])

  return (
      <div className="sync-dialog" aria-label={title}>
        <header className="sync-head drag">
          <Icon name="git-branch" style={{ color: 'var(--ink-muted)' }} />
          <span style={{ fontWeight: 600 }}>
            {title} with {host?.name ?? 'server'}
          </span>
          <span className="spacer" />
          <SearchInput placeholder="Filter by path" width={220} value={st.query} onValueChange={st.setQuery} />
          <Button variant="ghost" size="sm" icon={st.loading ? 'spinner' : 'refresh'} disabled={st.loading} onClick={() => void st.rescan()}>
            {st.loading ? 'Comparing…' : 'Rescan'}
          </Button>
        </header>

        <div className="sync-roots">
          <span className="sync-root" title={roots.local}>
            <Icon name="laptop" />
            <span className="ell">{roots.local}</span>
          </span>
          <span />
          <span className="sync-root" title={roots.remote}>
            <Icon name="cloud" />
            <span className="ell">{roots.remote}</span>
          </span>
        </div>

        <div ref={listRef} className="sync-list" role="listbox" aria-label="Files that differ" tabIndex={0} onScroll={update} onKeyDown={onListKey}>
          <div className="sync-list-head">
            <span>Name</span>
            <span className="num">Size</span>
            <span>Date</span>
            <button
              type="button"
              className={`sync-act sync-act-${bulkGlyph}`}
              disabled={!live.length}
              title={`Set every listed file · next: ${ACTION[nextBulk].label}`}
              aria-label={`Set every listed file to ${ACTION[nextBulk].label}`}
              onClick={() => {
                st.setAll(keys, nextBulk)
                setLastBulk(nextBulk)
              }}
            >
              {bulkGlyph === 'mixed' ? '±' : ACTION[bulkGlyph].glyph}
            </button>
            <span>Date</span>
            <span className="num">Size</span>
            <span>Name</span>
          </div>
          {st.error ? (
            <div className="sync-note" style={{ color: 'var(--danger)' }}>
              {st.error}
            </div>
          ) : st.loading && !st.rows.length ? (
            <div className="sync-note">
              <Icon name="spinner" className="spin" /> Comparing local files with {host?.name ?? 'the server'}…
            </div>
          ) : !shown.length ? (
            <div className="sync-note">{st.rows.length ? 'Nothing matches the filter' : 'Everything is in sync'}</div>
          ) : (
            <div style={{ height: shown.length * ROW, position: 'relative' }}>
              <div style={{ position: 'absolute', top: range.from * ROW, left: 0, right: 0 }}>
                {shown.slice(range.from, range.to).map((r) => {
                  const resolved = st.resolved.has(r.remotePath)
                  const a = resolved ? 'skip' : (st.actions[r.remotePath] ?? r.action)
                  const active = r.remotePath === st.active
                  const tone = resolved ? 'synced' : r.status
                  return (
                    <div
                      key={r.remotePath}
                      role="option"
                      aria-selected={active}
                      className={'sync-row' + (active ? ' sync-row-active' : '') + (a === 'skip' ? ' sync-row-skip' : '')}
                      onMouseDown={() => st.setActive(r.remotePath)}
                    >
                      {cells(r.local, r, tone, 'local')}
                      <button
                        type="button"
                        className={`sync-act sync-act-${a}`}
                        disabled={resolved}
                        title={resolved ? 'In sync' : `${ACTION[a].label} · click to change`}
                        aria-label={`${r.relPath}: ${resolved ? 'in sync' : ACTION[a].label}. Change action`}
                        onClick={() => st.cycle(r.remotePath)}
                      >
                        {resolved ? <Icon name="check" /> : ACTION[a].glyph}
                      </button>
                      {cells(r.remote, r, tone, 'remote')}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="sync-split" />
        <DiffPanel />

        <footer className="sync-foot">
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="secondary"
            disabled={!activeReady || st.applying || st.loading}
            title={activeRow ? (activeReady ? `Sync only ${activeRow.relPath}` : 'The selected file is set to skip') : 'Select a file first'}
            onClick={() => st.active && void st.apply(new Set([st.active]))}
          >
            Sync Selected
          </Button>
          <Button variant="primary" icon="git-branch" disabled={!(ups + downs) || st.applying || st.loading} onClick={() => void st.apply()}>
            {ups + downs ? `Synchronize ${ups + downs} file${ups + downs === 1 ? '' : 's'}` : 'Synchronize'}
          </Button>
        </footer>
      </div>
  )
}
