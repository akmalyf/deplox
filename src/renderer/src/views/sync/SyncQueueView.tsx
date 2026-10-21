import { useEffect, useMemo, useState } from 'react'
import { Button, Chip, EmptyState, Icon, SearchInput, StatusDot } from '@/ds'
import type { SyncItem } from '@shared/types'
import { basename } from '@shared/paths'
import { formatBytes, formatClock } from '@shared/format'
import { useSync, type SyncFilter } from '../../stores/sync'
import { useActiveProject, useProjectHosts } from '../../stores/app'
import { useUi, toast } from '../../stores/ui'
import { useTransfers } from '../../stores/transfers'
import { invoke, errorText } from '../../lib/ipc'
import { openCompare } from '../../lib/actions'
import { Header, ProjectSwitch, Sep } from '../../shell/HeaderParts'
import { Modal } from '../../shell/dialogs/Modal'

const KIND: Record<SyncItem['kind'], { label: string; icon: string; color: string }> = {
  upload: { label: 'Upload', icon: 'arrow-up-right', color: 'var(--ink)' },
  download: { label: 'Download', icon: 'arrow-down', color: 'var(--ink)' },
  'delete-remote': { label: 'Delete remote', icon: 'x', color: 'var(--ink)' },
  conflict: { label: 'Conflict', icon: 'copy', color: 'var(--warning)' },
  failed: { label: 'Failed', icon: 'x', color: 'var(--danger)' }
}

function dirOf(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i < 0 ? '/ (project root)' : rel.slice(0, i)
}

function Row({ it, hostName, active, selected, onOpen, onToggle, showCheck = true, trailing }: { it: SyncItem; hostName: string; active: boolean; selected: boolean; onOpen: () => void; onToggle?: () => void; showCheck?: boolean; trailing?: React.ReactNode }) {
  const k = KIND[it.kind]
  const done = it.group === 'done'
  return (
    <div className={active ? 'q-row q-row-active' : 'q-row'}>
      {showCheck ? <input type="checkbox" className="q-check" checked={selected} onChange={onToggle} aria-label={`Select ${basename(it.relPath)}`} /> : <span />}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: done ? 'var(--ink-muted)' : k.color }}>
        <Icon name={k.icon} />
        {k.label}
      </span>
      <button type="button" className="q-open" onClick={onOpen} title={it.localPath}>
        <span className="q-ell" style={{ fontWeight: done ? 400 : 500, color: done ? 'var(--ink-muted)' : undefined }}>
          {basename(it.relPath)}
        </span>
        <span className="q-ell q-mono q-dim">{dirOf(it.relPath)}</span>
      </button>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span className="q-ell" style={{ color: done ? 'var(--ink-muted)' : undefined }}>
          {hostName}
        </span>
        <span className="q-dim" style={{ fontSize: 12, lineHeight: '16px' }}>
          {it.size ? formatBytes(it.size) : '—'}
        </span>
      </span>
      <span className={done ? 'q-ell q-dim' : 'q-ell'} style={{ color: done ? undefined : 'var(--ink-muted)' }} title={it.reason}>
        {it.reason}
      </span>
      <span style={{ display: 'flex', justifyContent: 'flex-end' }}>{trailing}</span>
    </div>
  )
}

export function SyncQueueView() {
  const project = useActiveProject()
  const hosts = useProjectHosts()
  const allItems = useSync((s) => s.items)
  const st = useSync()
  const queuePaused = useTransfers((s) => Object.values(s.jobs).some((j) => j.state === 'paused' && !j.error))
  const editHost = useUi((s) => s.editHost)
  const [confirm, setConfirm] = useState<'all' | 'selected' | null>(null)
  const hostName = (id: string) => hosts.find((h) => h.id === id)?.name ?? 'host'

  const items = useMemo(() => allItems.filter((i) => i.projectId === project?.id), [allItems, project?.id])
  const q = st.query.trim().toLowerCase()
  const match = (i: SyncItem) => {
    if (q && !i.relPath.toLowerCase().includes(q)) return false
    if (st.filter === 'all') return true
    if (st.filter === 'attn') return i.group === 'attn'
    return i.kind === st.filter
  }
  const attn = items.filter((i) => i.group === 'attn' && match(i))
  const wait = items.filter((i) => i.group === 'wait' && match(i))
  const done = items.filter((i) => i.group === 'done' && match(i)).sort((a, b) => b.updatedAt - a.updatedAt)
  const pending = items.filter((i) => i.group !== 'done')
  const attnCount = items.filter((i) => i.group === 'attn').length
  const ready = items.filter((i) => i.group === 'wait')
  const active = items.find((i) => i.id === st.activeId) ?? attn[0] ?? wait[0] ?? done[0]
  const selItems = items.filter((i) => st.selected.has(i.id) && i.group !== 'done')
  const selSize = selItems.reduce((s, i) => s + i.size, 0)

  const scan = async () => {
    if (!project) return
    st.setScanning(true)
    try {
      await invoke('sync:scan', project.id)
    } catch (e) {
      toast(errorText(e), 'danger')
    } finally {
      st.setScanning(false)
    }
  }

  // First visit: scan once so the queue reflects the servers too.
  useEffect(() => {
    if (project && !items.length && hosts.length) void scan()
  }, [project?.id])

  const FILTERS: { id: SyncFilter; label: string }[] = [
    { id: 'all', label: `All · ${pending.length}` },
    { id: 'upload', label: `Uploads · ${pending.filter((i) => i.kind === 'upload').length}` },
    { id: 'download', label: `Downloads · ${pending.filter((i) => i.kind === 'download').length}` },
    { id: 'delete-remote', label: `Deletes · ${pending.filter((i) => i.kind === 'delete-remote').length}` },
    { id: 'attn', label: `Needs attention · ${attnCount}` }
  ]

  const runList = confirm === 'all' ? ready : selItems.filter((i) => i.group === 'wait')
  const skipList = confirm === 'all' ? items.filter((i) => i.group === 'attn') : selItems.filter((i) => i.group === 'attn')

  const doRun = async () => {
    const ids = runList.map((i) => i.id)
    setConfirm(null)
    try {
      await invoke('sync:run', ids)
      st.setSelected(new Set())
      toast(`${ids.length} item${ids.length === 1 ? '' : 's'} queued for transfer`, 'success')
    } catch (e) {
      toast(errorText(e), 'danger')
    }
  }

  const resolve = async (it: SyncItem, resolution: 'upload' | 'download') => {
    try {
      await invoke('sync:resolve', { id: it.id, resolution })
    } catch (e) {
      toast(errorText(e), 'danger')
    }
  }

  const sections = (
    <>
      {attn.length ? (
        <section aria-label="Needs attention" className="card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 16px' }}>
            <StatusDot status="warning" label="Warning" />
            <span style={{ fontWeight: 500 }}>Needs attention</span>
            <span className="q-dim">{attn.length}</span>
            <span className="spacer" />
            <span className="q-dim" style={{ fontSize: 12 }}>
              Resolve before running the queue
            </span>
          </div>
          {attn.map((it) => (
            <Row
              key={it.id}
              it={it}
              hostName={hostName(it.hostId)}
              active={active?.id === it.id}
              selected={st.selected.has(it.id)}
              onToggle={() => st.toggle(it.id)}
              onOpen={() => st.setActive(it.id)}
              trailing={
                it.kind === 'conflict' ? (
                  <button type="button" className="q-btn" onClick={() => openCompare({ hostId: it.hostId, localPath: it.localPath, remotePath: it.remotePath })}>
                    Compare
                  </button>
                ) : (
                  <Button size="sm" onClick={() => void invoke('sync:run', [it.id])}>
                    Retry
                  </Button>
                )
              }
            />
          ))}
        </section>
      ) : null}
      {wait.length ? (
        <section aria-label="Waiting" className="card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 16px' }}>
            <span style={{ fontWeight: 500 }}>Waiting</span>
            <span className="q-dim">{wait.length}</span>
            <span className="spacer" />
            <Button variant="ghost" size="sm" onClick={() => st.setSelected(new Set([...st.selected, ...wait.map((i) => i.id)]))}>
              Select all
            </Button>
          </div>
          <div className="q-head" aria-hidden="true">
            <span />
            <span>Action</span>
            <span>File</span>
            <span>Host</span>
            <span>Queued because</span>
            <span />
          </div>
          {wait.map((it) => (
            <Row
              key={it.id}
              it={it}
              hostName={hostName(it.hostId)}
              active={active?.id === it.id}
              selected={st.selected.has(it.id)}
              onToggle={() => st.toggle(it.id)}
              onOpen={() => st.setActive(it.id)}
              trailing={
                <Button variant="ghost" size="sm" icon="x" iconOnly onClick={() => void invoke('sync:remove', [it.id])}>
                  Remove from queue
                </Button>
              }
            />
          ))}
        </section>
      ) : null}
      {done.length ? (
        <section aria-label="Completed today" className="card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 16px' }}>
            <StatusDot status="success" label="Done" />
            <span style={{ fontWeight: 500 }}>Completed today</span>
            <span className="q-dim">{done.length}</span>
            <span className="spacer" />
            <Button variant="ghost" size="sm" onClick={() => void invoke('sync:clearDone')}>
              Clear
            </Button>
          </div>
          {done.map((it) => (
            <Row key={it.id} it={it} hostName={hostName(it.hostId)} active={active?.id === it.id} selected={false} showCheck={false} onOpen={() => st.setActive(it.id)} />
          ))}
        </section>
      ) : null}
    </>
  )

  const empty = !attn.length && !wait.length && !done.length

  return (
    <>
      <Header>
        <ProjectSwitch />
        <Sep />
        <span style={{ color: 'var(--ink)', fontWeight: 500, padding: '0 8px', whiteSpace: 'nowrap' }}>Sync Queue</span>
        <span className="ell" style={{ fontSize: 12 }}>
          {pending.length} pending · {attnCount} need attention · upload on save {hosts.some((h) => h.behavior.uploadOnSave) ? 'on' : 'off'}
        </span>
        <span className="spacer" />
        <Button variant="ghost" size="sm" icon={st.scanning ? 'spinner' : 'search'} disabled={st.scanning || !hosts.length} onClick={() => void scan()}>
          {st.scanning ? 'Scanning…' : 'Rescan changes'}
        </Button>
        <Button variant="ghost" size="sm" icon={queuePaused ? 'play' : 'pause'} onClick={() => void invoke(queuePaused ? 'transfers:resumeAll' : 'transfers:pauseAll')}>
          {queuePaused ? 'Resume queue' : 'Pause queue'}
        </Button>
        <Button variant="primary" size="sm" icon="git-branch" disabled={!ready.length} onClick={() => setConfirm('all')}>
          Run {ready.length} ready item{ready.length === 1 ? '' : 's'}…
        </Button>
      </Header>

      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', padding: '16px 16px 0', gap: 12 }}>
          <div role="toolbar" aria-label="Filter queue" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {FILTERS.map((f) => (
              <Chip key={f.id} selected={st.filter === f.id} onClick={() => st.setFilter(f.id)}>
                {f.label}
              </Chip>
            ))}
            <span className="spacer" />
            <SearchInput placeholder="Filter by path" width={220} value={st.query} onValueChange={st.setQuery} />
          </div>
          <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 16 }}>
            {empty ? (
              <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 32px', gap: 16, textAlign: 'center' }}>
                <span className="icon-disc" style={{ color: 'var(--success-text)' }}>
                  <Icon name={st.scanning ? 'spinner' : 'check'} className={st.scanning ? 'spin' : undefined} />
                </span>
                <EmptyState
                  align="center"
                  title={st.scanning ? 'Scanning for changes…' : st.query || st.filter !== 'all' ? 'Nothing matches the filter' : 'Everything is in sync'}
                  description={hosts.length ? `Files you save in ${project?.name ?? 'this project'} appear here before they go to a server` : 'Add a host to start syncing'}
                />
                {hosts.length ? (
                  <Button icon="search" disabled={st.scanning} onClick={() => void scan()}>
                    Rescan changes
                  </Button>
                ) : (
                  <Button variant="primary" icon="plus" onClick={() => editHost('new')}>
                    Add Host
                  </Button>
                )}
              </div>
            ) : (
              sections
            )}
          </div>
        </div>

        <aside aria-label="Item details" style={{ width: 320, flex: '0 0 auto', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {active ? (
            <>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, borderBottom: '1px solid var(--line)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: KIND[active.kind].color }}>
                  <Icon name={KIND[active.kind].icon} />
                  {KIND[active.kind].label}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: 17, lineHeight: '22px', fontWeight: 600, letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>{basename(active.relPath)}</span>
                  <span className="q-mono q-dim" style={{ overflowWrap: 'anywhere' }}>
                    {active.relPath}
                  </span>
                </div>
                <span className="muted">{active.reason}</span>
              </div>
              <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="card" style={{ padding: '4px 0' }}>
                  {(
                    [
                      ['Host', hostName(active.hostId)],
                      ['Local', active.localInfo || '—'],
                      ['Remote', active.remoteInfo || '—'],
                      ['Size', active.size ? formatBytes(active.size) : '—'],
                      ['Remote path', active.remotePath],
                      ['Updated', formatClock(active.updatedAt)]
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 12px', fontSize: 12, lineHeight: '16px' }}>
                      <span style={{ color: 'var(--ink-muted)', flex: '0 0 auto' }}>{k}</span>
                      <span style={{ color: 'var(--ink)', textAlign: 'right', overflowWrap: 'anywhere' }}>{v}</span>
                    </div>
                  ))}
                </div>
                {active.kind === 'conflict' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--ink-muted)' }}>Both copies changed since your last sync. Pick one or merge line by line.</span>
                    <Button variant="secondary" icon="copy" onClick={() => openCompare({ hostId: active.hostId, localPath: active.localPath, remotePath: active.remotePath })}>
                      Open in Compare
                    </Button>
                    <Button variant="outline" icon="arrow-up-right" onClick={() => void resolve(active, 'upload')}>
                      Keep local, upload
                    </Button>
                    <Button variant="outline" icon="arrow-down" onClick={() => void resolve(active, 'download')}>
                      Keep remote, download
                    </Button>
                  </div>
                ) : active.kind === 'failed' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--ink-muted)' }}>{active.reason}. Fix the host if needed, then retry.</span>
                    <Button variant="secondary" icon="pencil" onClick={() => editHost(active.hostId)}>
                      Edit host
                    </Button>
                    <Button variant="outline" icon="refresh" onClick={() => void invoke('sync:run', [active.id])}>
                      Retry now
                    </Button>
                  </div>
                ) : active.group === 'wait' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Button variant="outline" onClick={() => void invoke('sync:run', [active.id])}>
                      Run this item now
                    </Button>
                    {active.kind !== 'delete-remote' ? (
                      <Button variant="ghost" icon="copy" onClick={() => openCompare({ hostId: active.hostId, localPath: active.localPath, remotePath: active.remotePath })}>
                        Compare first
                      </Button>
                    ) : null}
                    <Button variant="ghost" onClick={() => void invoke('sync:remove', [active.id])}>
                      Remove from queue
                    </Button>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div style={{ padding: 16, color: 'var(--ink-subtle)' }}>Select an item to see its details</div>
          )}
        </aside>
      </div>

      <footer style={{ height: 56, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', borderTop: '1px solid var(--line)' }}>
        <span style={{ color: 'var(--ink)' }}>{selItems.length} selected</span>
        <span className="q-dim">{selSize ? formatBytes(selSize) : ''}</span>
        <span className="spacer" />
        <Button variant="ghost" disabled={!st.selected.size} onClick={() => st.setSelected(new Set())}>
          Clear selection
        </Button>
        <Button variant="outline" icon="x" disabled={!selItems.length} onClick={() => void invoke('sync:remove', selItems.map((i) => i.id))}>
          Remove from queue
        </Button>
        <Button variant="primary" icon="git-branch" disabled={!selItems.some((i) => i.group === 'wait')} onClick={() => setConfirm('selected')}>
          Sync selected…
        </Button>
      </footer>

      {confirm ? (
        <Modal label="Run sync" onCancel={() => setConfirm(null)} width={480} role="alertdialog">
          <RunConfirm runList={runList} skipList={skipList} hostName={hostName} onCancel={() => setConfirm(null)} onReview={() => (setConfirm(null), st.setFilter('attn'))} onRun={() => void doRun()} />
        </Modal>
      ) : null}
    </>
  )
}

function RunConfirm({ runList, skipList, hostName, onCancel, onReview, onRun }: { runList: SyncItem[]; skipList: SyncItem[]; hostName: (id: string) => string; onCancel: () => void; onReview: () => void; onRun: () => void }) {
  const tally = (k: SyncItem['kind']) => runList.filter((q) => q.kind === k).length
  const parts: string[] = []
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  if (tally('upload')) parts.push(plural(tally('upload'), 'upload'))
  if (tally('download')) parts.push(plural(tally('download'), 'download'))
  if (tally('delete-remote')) parts.push(plural(tally('delete-remote'), 'delete'))
  const hosts = [...new Set(runList.map((q) => hostName(q.hostId)))]
  const deletes = runList.filter((q) => q.kind === 'delete-remote')
  const conflicts = skipList.filter((q) => q.kind === 'conflict').length
  const failed = skipList.length - conflicts
  const skipBits = [conflicts && plural(conflicts, 'conflict'), failed && plural(failed, 'failed transfer')].filter(Boolean).join(' and ')
  return (
    <>
      <h2>
        Sync {plural(runList.length, 'item')}
        {hosts.length ? ` to ${hosts.join(' and ')}` : ''}?
      </h2>
      <p>{parts.length ? `${parts.join(' · ')}.${tally('upload') ? ' Files on the server are overwritten with your local copy.' : ''}` : 'Nothing ready to sync in this selection.'}</p>
      {deletes.length ? (
        <div className="card" style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger)', fontWeight: 500 }}>
            <Icon name="x" />
            Deletes on the server
          </span>
          {deletes.map((d) => (
            <span key={d.id} className="mono" style={{ overflowWrap: 'anywhere' }}>
              {hostName(d.hostId)}:{d.remotePath}
            </span>
          ))}
        </div>
      ) : null}
      {skipList.length ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: 'var(--ink-muted)' }}>
          <span style={{ paddingTop: 5 }}>
            <StatusDot status="warning" label="Warning" />
          </span>
          <span>
            {plural(skipList.length, 'item')} will be skipped until you resolve {skipList.length > 1 ? 'them' : 'it'}: {skipBits}.
          </span>
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        {skipList.length ? (
          <Button variant="link" onClick={onReview}>
            Review items first
          </Button>
        ) : null}
        <span className="spacer" />
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" icon="git-branch" disabled={!runList.length} onClick={onRun}>
          Sync {plural(runList.length, 'item')}
        </Button>
      </div>
    </>
  )
}
