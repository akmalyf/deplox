import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Chip, CodeLine, EmptyState, Icon, MenuItem, MenuPopover, Select, StatusDot, type Lang } from '@/ds'
import { basename } from '@shared/paths'
import { formatWhen } from '@shared/format'
import { languageOf, mergeDetailed, type DiffRow } from '@shared/compare'
import { useCompare } from '../../stores/compare'
import { useActiveHost, useApp } from '../../stores/app'
import { useBrowser, counterpart } from '../../stores/browser'
import { useSync } from '../../stores/sync'
import { useUi } from '../../stores/ui'
import { copyText } from '../../lib/actions'
import { Crumbs, Header, Sep } from '../../shell/HeaderParts'

const ROW = 22
const OVERSCAN = 20

const BG = { '': 'transparent', add: 'var(--diff-added-bg)', mod: 'var(--diff-modified-bg)', del: 'var(--diff-deleted-bg)' } as const

function sideBg(r: DiffRow, side: 'l' | 'r'): string {
  if (!r.kind) return 'transparent'
  const pad = side === 'l' ? r.localNo === null : r.remoteNo === null
  if (pad) return 'var(--diff-modified-bg)'
  if (r.kind === 'add') return side === 'l' ? BG.add : 'var(--diff-modified-bg)'
  if (r.kind === 'del') return side === 'r' ? BG.del : 'var(--diff-modified-bg)'
  return BG.mod
}

/** Files that differ on the active host, from what the browser and sync queue already know. */
function useChangedFiles(hostId: string | undefined): { localPath: string; remotePath: string }[] {
  const local = useBrowser((s) => s.local)
  const remote = useBrowser((s) => s.remote)
  const items = useSync((s) => s.items)
  return useMemo(() => {
    const out = new Map<string, { localPath: string; remotePath: string }>()
    if (!hostId) return []
    for (const [dir, list] of Object.entries(local.entries)) {
      const rdir = counterpart('local', dir, local.root, remote.root)
      const rlist = rdir ? remote.entries[rdir] : undefined
      if (!rlist) continue
      for (const e of list) {
        if (e.type !== 'file') continue
        const twin = rlist.find((x) => x.name === e.name && x.type === 'file')
        if (twin && twin.size !== e.size) out.set(e.path, { localPath: e.path, remotePath: twin.path })
      }
    }
    for (const it of items) {
      if (it.hostId === hostId && (it.kind === 'conflict' || it.kind === 'upload' || it.kind === 'download') && it.group !== 'done') out.set(it.localPath, { localPath: it.localPath, remotePath: it.remotePath })
    }
    return [...out.values()].sort((a, b) => a.localPath.localeCompare(b.localPath))
  }, [hostId, local, remote, items])
}

function DiffRows({ rows, lang, onHunk }: { rows: DiffRow[]; lang: Lang; onHunk: (id: number, side: 'remote' | 'local') => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ from: 0, to: 80 })
  const selected = useCompare((s) => s.selected)
  const toggleRow = useCompare((s) => s.toggleRow)
  const cursor = useCompare((s) => s.cursor)
  const hunks = useCompare((s) => s.hunks)
  const writing = useCompare((s) => s.writing)
  const cur = hunks[cursor]
  // Ignore » / « clicks right after the diff appears: the click that opened Compare must not land on them.
  const [armedAt, setArmedAt] = useState(() => Date.now() + 700)
  const pairKey = useCompare((s) => (s.pair ? s.pair.localPath + '|' + s.pair.remotePath : ''))
  useEffect(() => setArmedAt(Date.now() + 700), [pairKey])
  const hunk = (id: number, side: 'remote' | 'local') => {
    if (Date.now() < armedAt) return
    onHunk(id, side)
  }

  const update = () => {
    const el = ref.current
    if (!el) return
    const from = Math.max(0, Math.floor(el.scrollTop / ROW) - OVERSCAN)
    const to = Math.min(rows.length, Math.ceil((el.scrollTop + el.clientHeight) / ROW) + OVERSCAN)
    setRange((r) => (r.from === from && r.to === to ? r : { from, to }))
  }
  useEffect(update, [rows.length])
  // Scroll only when the user moves between differences, not when the diff is rebuilt after a merge.
  const nav = useCompare((s) => s.navTick)
  useEffect(() => {
    const el = ref.current
    const h = useCompare.getState().hunks[useCompare.getState().cursor]
    if (!el || !h || !nav) return
    const top = h.start * ROW
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - ROW * 3) el.scrollTo({ top: Math.max(0, top - el.clientHeight / 3) })
  }, [nav])

  return (
    <div ref={ref} onScroll={update} style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', fontFamily: 'var(--font-mono)', fontSize: 14, lineHeight: '22px', fontVariantLigatures: 'none', color: 'var(--code-text)' }}>
      <div style={{ height: rows.length * ROW + 12, position: 'relative' }}>
        <div style={{ position: 'absolute', top: range.from * ROW + 6, left: 0, right: 0 }}>
          {rows.slice(range.from, range.to).map((r) => {
            const sel = selected.has(r.id)
            const inCursor = cur && r.hunkId === cur.id
            const lineNo = r.localNo ?? r.remoteNo
            return (
              <div key={r.id} className={inCursor ? 'cmp-row cmp-row-cursor' : 'cmp-row'}>
                <div className="cmp-code" style={{ background: sideBg(r, 'l'), boxShadow: r.kind && sel ? 'inset 0 0 0 1px var(--diff-connector)' : undefined }}>
                  <CodeLine text={r.localText} lang={lang} />
                </div>
                <div className="cmp-gutter" style={{ background: r.kind ? 'var(--code-line)' : 'transparent' }}>
                  <span style={{ textAlign: 'right', paddingRight: 4 }}>{r.localNo ?? ''}</span>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ width: 22, display: 'inline-flex', justifyContent: 'center' }}>
                      {r.hunkStart ? (
                        <button type="button" className="line-act" disabled={writing} aria-label={`Upload change ${r.hunkId} to remote`} title="Upload this change to remote" onClick={() => hunk(r.hunkId!, 'remote')}>
                          »
                        </button>
                      ) : null}
                    </span>
                    <span style={{ width: 24, display: 'inline-flex', justifyContent: 'center' }}>
                      {r.kind ? (
                        <label className="check-hit">
                          <input type="checkbox" className="line-check" checked={sel} onChange={() => toggleRow(r.id)} aria-label={`Select line ${lineNo}`} />
                        </label>
                      ) : null}
                    </span>
                    <span style={{ width: 22, display: 'inline-flex', justifyContent: 'center' }}>
                      {r.hunkStart ? (
                        <button type="button" className="line-act" disabled={writing} aria-label={`Take change ${r.hunkId} from remote`} title="Take this change from remote" onClick={() => hunk(r.hunkId!, 'local')}>
                          «
                        </button>
                      ) : null}
                    </span>
                  </span>
                  <span style={{ textAlign: 'left', paddingLeft: 4 }}>{r.remoteNo ?? ''}</span>
                </div>
                <div className="cmp-code" style={{ background: sideBg(r, 'r'), boxShadow: r.kind && sel ? 'inset 0 0 0 1px var(--diff-connector)' : undefined }}>
                  <CodeLine text={r.remoteText} lang={lang} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ResultPreview({ lang, hostName }: { lang: Lang; hostName: string }) {
  const rows = useCompare((s) => s.rows)
  const selected = useCompare((s) => s.selected)
  const side = useCompare((s) => s.previewSide)
  const setSide = useCompare((s) => s.setPreviewSide)
  const setShow = useCompare((s) => s.setShowPreview)
  const lines = useMemo(() => mergeDetailed(rows, selected, side), [rows, selected, side])
  const changed = lines.filter((l) => l.fromOther).length
  const first = lines.findIndex((l) => l.fromOther)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current && first >= 0) ref.current.scrollTop = Math.max(0, (first - 2) * ROW)
  }, [first])
  return (
    <section aria-label="Result preview" style={{ flex: '0 0 auto', height: 208, marginTop: 12, display: 'flex', flexDirection: 'column', background: 'var(--code-bg)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ height: 36, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 12px', background: 'var(--bg-card)', borderBottom: '1px solid var(--code-guide)' }}>
        <Icon name={side === 'remote' ? 'cloud' : 'laptop'} style={{ color: 'var(--ink-muted)' }} />
        <span style={{ fontWeight: 500 }}>{side === 'remote' ? `Result on ${hostName} after upload` : 'Local file after taking changes'}</span>
        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
          {changed} line{changed === 1 ? '' : 's'} from {side === 'remote' ? 'local' : 'remote'} · everything else stays as {side === 'remote' ? 'on the server' : 'in your file'}
        </span>
        <span className="spacer" />
        <Chip shape="square" selected={side === 'remote'} onClick={() => setSide('remote')}>
          Remote
        </Chip>
        <Chip shape="square" selected={side === 'local'} onClick={() => setSide('local')}>
          Local
        </Chip>
        <Button variant="ghost" size="sm" icon="x" iconOnly onClick={() => setShow(false)}>
          Hide result preview
        </Button>
      </div>
      <div ref={ref} style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', fontFamily: 'var(--font-mono)', fontSize: 14, lineHeight: '22px', fontVariantLigatures: 'none', color: 'var(--code-text)', padding: '4px 0' }}>
        {lines.slice(0, 5000).map((l, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '52px 20px minmax(0, 1fr)', height: 22, background: l.fromOther ? 'var(--diff-added-bg)' : 'transparent' }}>
            <span style={{ textAlign: 'right', paddingRight: 8, color: 'var(--code-gutter)', userSelect: 'none' }}>{i + 1}</span>
            <span style={{ color: 'var(--success-text)', userSelect: 'none' }}>{l.fromOther ? '+' : ''}</span>
            <span style={{ whiteSpace: 'pre', overflow: 'hidden' }}>
              <CodeLine text={l.text} lang={lang} />
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

export function CompareView() {
  const host = useActiveHost()
  const hosts = useApp((s) => s.hosts)
  const st = useCompare()
  const changed = useChangedFiles(host?.id)
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number } | null>(null)
  const [more, setMore] = useState<{ x: number; y: number } | null>(null)
  const pairHost = hosts.find((h) => h.id === st.pair?.hostId) ?? host
  const lang = languageOf(st.pair?.localPath ?? '')
  const changeCount = st.rows.filter((r) => r.kind).length
  const selCount = [...st.selected].length
  const idx = st.pair ? changed.findIndex((c) => c.localPath === st.pair!.localPath) : -1

  const onHunk = (id: number, side: 'remote' | 'local') => void st.apply(side, id)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox') return
      if (useUi.getState().view !== 'compare') return
      if (e.key === 'F7' || (e.altKey && e.key === 'ArrowDown')) {
        e.preventDefault()
        st.setCursor(e.shiftKey ? st.cursor - 1 : st.cursor + 1)
      } else if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault()
        st.setCursor(st.cursor - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [st])

  const open = (c: { localPath: string; remotePath: string }) => host && void st.open({ hostId: host.id, ...c })

  return (
    <>
      <Header>
        <Crumbs>
          <Sep />
          <Select
            value={st.pair ? basename(st.pair.localPath) : 'Choose a file'}
            icon="file-code"
            label={idx >= 0 ? `Changed file, ${idx + 1} of ${changed.length}` : 'Choose a file to compare'}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setFileMenu({ x: r.left, y: r.bottom + 4 })
            }}
          />
          {changed.length ? <span style={{ fontSize: 12, color: 'var(--ink-subtle)', whiteSpace: 'nowrap' }}>{idx >= 0 ? `${idx + 1} of ${changed.length} changed` : `${changed.length} changed`}</span> : null}
          {st.pair && !st.loading && !st.error ? <Badge tone={st.hunks.length ? 'accent' : 'success'}>{st.hunks.length ? `${st.hunks.length} difference${st.hunks.length === 1 ? '' : 's'}` : 'Identical'}</Badge> : null}
        </Crumbs>
        <span className="spacer" />
        <Button variant="ghost" size="sm" icon="chevron-up" iconOnly disabled={!st.hunks.length} onClick={() => st.setCursor(st.cursor - 1)}>
          Previous difference
        </Button>
        <Button variant="ghost" size="sm" icon="chevron-down" iconOnly disabled={!st.hunks.length} onClick={() => st.setCursor(st.cursor + 1)}>
          Next difference
        </Button>
        <Chip shape="square" selected={st.ignoreWs} onClick={() => st.setIgnoreWs(!st.ignoreWs)}>
          Ignore whitespace
        </Chip>
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

      {!st.pair ? (
        <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <EmptyState
            align="center"
            title="Pick a file to compare"
            description="Double-click a file in Remote Browser, or right-click it and choose Compare. Changed files you've browsed are listed above."
          >
            {changed.length ? (
              <div className="card" style={{ width: 480, maxHeight: 280, overflow: 'auto', padding: 4, textAlign: 'left' }}>
                {changed.slice(0, 50).map((c) => (
                  <button key={c.localPath} type="button" className="pal-row" onClick={() => open(c)}>
                    <Icon name="file-code" />
                    <span className="ell">{basename(c.localPath)}</span>
                    <span className="ell" style={{ flex: '1 1 auto', fontSize: 12, color: 'var(--ink-subtle)' }}>
                      {c.remotePath}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </EmptyState>
        </div>
      ) : (
        <div style={{ flex: '1 1 auto', minHeight: 0, padding: '12px 16px 0', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--code-bg)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ height: 36, flex: '0 0 auto', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 150px minmax(0, 1fr)', alignItems: 'center', borderBottom: '1px solid var(--code-guide)', background: 'var(--bg-card)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden' }} title={st.pair.localPath}>
                <Icon name="laptop" style={{ color: 'var(--ink-muted)' }} />
                <span style={{ fontWeight: 500 }}>Local</span>
                <span className="ell" style={{ fontSize: 12, color: 'var(--ink-subtle)' }}>
                  {st.local ? (st.local.exists ? `${st.pair.localPath} · saved ${formatWhen(st.local.mtime)}${st.local.eol === '\r\n' ? ' · CRLF' : ''}` : 'Not on this computer yet') : ''}
                </span>
              </div>
              <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-subtle)' }}>» upload · ☐ line · « take</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden' }} title={st.pair.remotePath}>
                <Icon name="cloud" style={{ color: 'var(--ink-muted)' }} />
                <span style={{ fontWeight: 500 }}>Remote</span>
                {st.remote && st.remoteNewer ? (
                  <>
                    <StatusDot status="warning" label="Warning" />
                    <span className="ell" style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                      changed {formatWhen(st.remote.mtime)}, after your last sync
                    </span>
                  </>
                ) : (
                  <span className="ell" style={{ fontSize: 12, color: 'var(--ink-subtle)' }}>
                    {st.remote ? (st.remote.exists ? `${pairHost?.name}:${st.pair.remotePath} · ${formatWhen(st.remote.mtime)}${st.remote.eol === '\r\n' ? ' · CRLF' : ''}` : 'Not on the server yet') : ''}
                  </span>
                )}
              </div>
            </div>
            {st.loading ? (
              <div style={{ padding: 16, color: 'var(--ink-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="spinner" className="spin" /> Loading both versions…
              </div>
            ) : st.error ? (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--danger)' }}>{st.error}</span>
                <Button size="sm" onClick={() => void st.reload()}>
                  Retry
                </Button>
              </div>
            ) : !st.hunks.length ? (
              <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <EmptyState align="center" title="Both copies are identical" description={st.ignoreWs ? 'Ignoring whitespace-only differences' : 'Local and remote have the same content'} />
              </div>
            ) : (
              <DiffRows rows={st.rows} lang={lang} onHunk={onHunk} />
            )}
          </div>
          {st.showPreview && st.hunks.length && !st.loading && !st.error ? <ResultPreview lang={lang} hostName={pairHost?.name ?? 'server'} /> : null}
        </div>
      )}

      <footer style={{ height: 60, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 16, padding: '0 16px' }}>
        {(
          [
            ['diff-added-bg', 'Local only'],
            ['diff-modified-bg', 'Changed'],
            ['diff-deleted-bg', 'Remote only']
          ] as const
        ).map(([c, l]) => (
          <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-muted)' }}>
            <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 3, background: `var(--${c})`, border: '1px solid var(--line-strong)' }} />
            {l}
          </span>
        ))}
        <span className="spacer" />
        <span style={{ color: 'var(--ink)' }}>
          {selCount} of {changeCount} lines selected
        </span>
        <Chip shape="square" selected={st.showPreview} onClick={() => st.setShowPreview(!st.showPreview)}>
          Result preview
        </Chip>
        <Button variant="ghost" disabled={!changeCount} onClick={() => (selCount === changeCount ? st.selectNone() : st.selectAll())}>
          {selCount === changeCount && changeCount ? 'Select none' : 'Select all'}
        </Button>
        <Button variant="outline" icon="arrow-down" disabled={!selCount || st.writing} onClick={() => void st.apply('local')}>
          Take selected from remote
        </Button>
        <Button variant="primary" icon="arrow-up-right" disabled={!selCount || st.writing} onClick={() => void st.apply('remote')}>
          Upload selected lines
        </Button>
      </footer>

      {fileMenu ? (
        <MenuPopover x={fileMenu.x} y={fileMenu.y} width={420} label="Changed files" onClose={() => setFileMenu(null)}>
          {changed.length ? (
            changed.slice(0, 40).map((c) => (
              <button key={c.localPath} type="button" role="menuitem" className="ad-menu-item" onClick={() => open(c)} title={c.remotePath}>
                <Icon name="file-code" />
                <span className="ad-menu-item-label ell">{basename(c.localPath)}</span>
                <span className="ell" style={{ fontSize: 11, color: 'var(--ink-subtle)', maxWidth: 220 }}>
                  {c.remotePath}
                </span>
                {st.pair?.localPath === c.localPath ? <Icon name="check" label="Current" /> : null}
              </button>
            ))
          ) : (
            <div style={{ padding: '8px 10px', color: 'var(--ink-subtle)', fontSize: 12 }}>No changed files found yet. Browse folders or rescan the Sync Queue.</div>
          )}
        </MenuPopover>
      ) : null}

      {more ? (
        <MenuPopover x={more.x} y={more.y} width={220} label="Compare actions" onClose={() => setMore(null)}>
          <MenuItem icon="refresh" disabled={!st.pair} onClick={() => void st.reload()}>
            Reload both
          </MenuItem>
          <MenuItem icon="file-text" disabled={!st.pair} onClick={() => st.pair && void copyText(st.pair.remotePath, 'Remote path')}>
            Copy Remote Path
          </MenuItem>
          <MenuItem icon="file-text" disabled={!st.pair} onClick={() => st.pair && void copyText(st.pair.localPath, 'Local path')}>
            Copy Local Path
          </MenuItem>
          <MenuItem separator />
          <MenuItem icon="arrow-up-right" disabled={!changeCount || st.writing} onClick={() => (st.selectAll(), void useCompare.getState().apply('remote'))}>
            Upload whole file
          </MenuItem>
          <MenuItem icon="arrow-down" disabled={!changeCount || st.writing} onClick={() => (st.selectAll(), void useCompare.getState().apply('local'))}>
            Take whole file
          </MenuItem>
          <MenuItem separator />
          <MenuItem icon="x" disabled={!st.pair} onClick={() => st.close()}>
            Close Compare
          </MenuItem>
        </MenuPopover>
      ) : null}
    </>
  )
}
