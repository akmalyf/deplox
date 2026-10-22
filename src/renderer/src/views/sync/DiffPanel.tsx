import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Chip, CodeLine, EmptyState, Icon, MenuItem, MenuPopover, type Lang } from '@/ds'
import { basename } from '@shared/paths'
import { languageOf, type DiffRow } from '@shared/compare'
import { useCompare } from '../../stores/compare'
import { useSyncDialog } from '../../stores/syncDialog'
import { useUi } from '../../stores/ui'
import { copyText } from '../../lib/actions'

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

function DiffRows({ rows, lang, onHunk }: { rows: DiffRow[]; lang: Lang; onHunk: (id: number, side: 'remote' | 'local') => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ from: 0, to: 80 })
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
            const inCursor = cur && r.hunkId === cur.id
            return (
              <div key={r.id} className={inCursor ? 'cmp-row cmp-row-cursor' : 'cmp-row'}>
                <div className="cmp-code" style={{ background: sideBg(r, 'l') }}>
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
                <div className="cmp-code" style={{ background: sideBg(r, 'r') }}>
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

/** Line-level diff of the file picked in the Sync dialog, with per-line upload / take. */
export function DiffPanel() {
  const st = useCompare()
  const [more, setMore] = useState<{ x: number; y: number } | null>(null)
  const lang = languageOf(st.pair?.localPath ?? '')
  const changeCount = st.rows.filter((r) => r.kind).length

  const onHunk = (id: number, side: 'remote' | 'local') => void st.apply(side, id)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox') return
      if (t.tagName === 'TEXTAREA' || t.isContentEditable) return
      const ui = useUi.getState()
      if (!useSyncDialog.getState().open || ui.paletteOpen || ui.confirm || ui.input || ui.prompts.length || ui.projectDialog) return
      // Ctrl+Z works on macOS too, next to ⌘Z.
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (mod && !e.altKey && key === 'z') {
        e.preventDefault()
        void (e.shiftKey ? st.redo() : st.undo())
        return
      }
      if (mod && !e.altKey && !e.shiftKey && key === 'y') {
        e.preventDefault()
        void st.redo()
        return
      }
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

  if (!st.pair) {
    return (
      <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <EmptyState align="center" title="Pick a file to see its changes" description="Select a row above. Lines can be uploaded or taken one by one here." />
      </div>
    )
  }

  return (
    <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 40, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
        <Icon name="file-code" style={{ color: 'var(--ink-muted)', flex: '0 0 auto' }} />
        <span className="ell" style={{ fontWeight: 500, minWidth: 0 }} title={st.pair.localPath}>
          {basename(st.pair.localPath)}
        </span>
        {!st.loading && !st.error ? <Badge tone={st.hunks.length ? 'accent' : 'success'}>{st.hunks.length ? `${st.hunks.length} difference${st.hunks.length === 1 ? '' : 's'}` : 'Identical'}</Badge> : null}
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
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, padding: '0 12px 12px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--code-bg)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
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
      </div>

      {more ? (
        <MenuPopover x={more.x} y={more.y} width={220} label="Diff actions" onClose={() => setMore(null)}>
          <MenuItem icon="refresh" onClick={() => void st.reload()}>
            Reload both
          </MenuItem>
          <MenuItem icon="file-text" onClick={() => st.pair && void copyText(st.pair.remotePath, 'Remote path')}>
            Copy Remote Path
          </MenuItem>
          <MenuItem icon="file-text" onClick={() => st.pair && void copyText(st.pair.localPath, 'Local path')}>
            Copy Local Path
          </MenuItem>
          <MenuItem separator />
          <MenuItem icon="arrow-up-right" disabled={!changeCount || st.writing} onClick={() => (st.selectAll(), void useCompare.getState().apply('remote'))}>
            Upload whole file
          </MenuItem>
          <MenuItem icon="arrow-down" disabled={!changeCount || st.writing} onClick={() => (st.selectAll(), void useCompare.getState().apply('local'))}>
            Take whole file
          </MenuItem>
        </MenuPopover>
      ) : null}
    </div>
  )
}
