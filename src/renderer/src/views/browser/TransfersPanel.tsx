import { useMemo } from 'react'
import { Button, Icon, PaneTab, ProgressBar } from '@/ds'
import type { TransferGroup, TransferJob } from '@shared/types'
import { basename } from '@shared/paths'
import { formatBytes, formatClock, formatSpeed } from '@shared/format'
import { useTransfers, transferRows } from '../../stores/transfers'
import { useBrowser } from '../../stores/browser'
import { useApp } from '../../stores/app'
import { invoke } from '../../lib/ipc'

const ICON: Record<string, string> = { upload: 'arrow-up-right', download: 'arrow-down', 'delete-remote': 'x', 'delete-local': 'x', 'mkdir-remote': 'folder-plus', 'mkdir-local': 'folder-plus' }
const DIR: Record<string, string> = { upload: 'Upload', download: 'Download', 'delete-remote': 'Delete on server', 'delete-local': 'Move to Trash', 'mkdir-remote': 'Create folder', 'mkdir-local': 'Create folder' }

function caption(state: TransferJob['state'], bytes: number, size: number, speed: number, error?: string, finishedAt?: number): string {
  switch (state) {
    case 'queued':
      return 'Queued'
    case 'active':
      return size > 0 ? `${formatBytes(bytes)} of ${formatBytes(size)}${speed ? ' · ' + formatSpeed(speed) : ''}` : 'Working…'
    case 'paused':
      return error === 'Waiting for connection' ? 'Waiting for connection' : `Paused${size > 0 ? ` · ${Math.floor((bytes / size) * 100)}%` : ''}`
    case 'failed':
      return `Failed${size > 0 && bytes ? ` at ${Math.floor((bytes / size) * 100)}%` : ''}`
    case 'canceled':
      return 'Canceled'
    case 'done':
      return `Done${size > 0 ? ' · ' + formatBytes(size) : ''}${finishedAt ? ' · ' + formatClock(finishedAt) : ''}`
  }
}

function Actions({ id, state, failed }: { id: string; state: TransferJob['state']; failed?: boolean }) {
  if (state === 'failed' || failed)
    return (
      <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
        <Button variant="ghost" size="sm" icon="refresh" iconOnly onClick={() => void invoke('transfers:retry', { ids: [id] })}>
          Resume
        </Button>
        <Button variant="ghost" size="sm" icon="x" iconOnly onClick={() => void invoke('transfers:remove', [id])}>
          Discard
        </Button>
      </span>
    )
  if (state === 'active' || state === 'queued')
    return (
      <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
        <Button variant="ghost" size="sm" icon="pause" iconOnly onClick={() => void invoke('transfers:pause', [id])}>
          Pause transfer
        </Button>
        <Button variant="ghost" size="sm" icon="x" iconOnly onClick={() => void invoke('transfers:cancel', [id])}>
          Cancel transfer
        </Button>
      </span>
    )
  if (state === 'paused')
    return (
      <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
        <Button variant="ghost" size="sm" icon="play" iconOnly onClick={() => void invoke('transfers:resume', [id])}>
          Resume transfer
        </Button>
        <Button variant="ghost" size="sm" icon="x" iconOnly onClick={() => void invoke('transfers:cancel', [id])}>
          Cancel transfer
        </Button>
      </span>
    )
  return (
    <span className="row" style={{ justifyContent: 'flex-end' }}>
      <Button variant="ghost" size="sm" icon="x" iconOnly onClick={() => void invoke('transfers:remove', [id])}>
        Remove from list
      </Button>
    </span>
  )
}

function JobRow({ j, hostName }: { j: TransferJob; hostName: string }) {
  const pct = j.size > 0 ? (j.bytes / j.size) * 100 : j.state === 'done' ? 100 : 0
  const name = basename(j.localPath || j.remotePath)
  const path = j.kind === 'download' || j.kind === 'mkdir-local' || j.kind === 'delete-local' ? `← ${j.remotePath}` : `→ ${hostName}:${j.remotePath}`
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr) 240px 170px 60px', alignItems: 'center', gap: 12, height: 38, padding: '0 8px 0 16px', borderBottom: '1px solid var(--line)' }} title={j.error}>
      <Icon name={ICON[j.kind]} label={DIR[j.kind]} style={{ color: 'var(--ink-muted)' }} />
      <div style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap', overflow: 'hidden' }}>
        <span style={{ color: 'var(--ink)' }}>{name}</span>
        <span className="mono ell" style={{ color: 'var(--ink-subtle)' }}>
          {path}
        </span>
      </div>
      <ProgressBar value={pct} tone={j.state === 'done' ? 'success' : j.state === 'failed' ? 'danger' : 'accent'} ariaLabel={`${DIR[j.kind]} ${name}`} />
      <span className="ell" style={{ fontSize: 12, color: j.state === 'failed' ? 'var(--danger)' : 'var(--ink-muted)', textAlign: 'right' }}>
        {j.state === 'failed' && j.error ? `${caption(j.state, j.bytes, j.size, 0)} · ${j.error}` : caption(j.state, j.bytes, j.size, j.speedBps, j.error, j.finishedAt)}
      </span>
      <Actions id={j.id} state={j.state} />
    </div>
  )
}

function GroupRow({ g, speed }: { g: TransferGroup; speed: number }) {
  const pct = g.size > 0 ? (g.bytes / g.size) * 100 : g.total ? (g.done / g.total) * 100 : 0
  const cap =
    g.state === 'active'
      ? `${g.done} of ${g.total}${g.size ? ' · ' + formatBytes(g.bytes) + ' of ' + formatBytes(g.size) : ''}${speed ? ' · ' + formatSpeed(speed) : ''}`
      : g.state === 'failed'
        ? `${g.failed} failed · ${g.done} of ${g.total} done`
        : caption(g.state, g.bytes, g.size, 0)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '16px minmax(0, 1fr) 240px 170px 60px', alignItems: 'center', gap: 12, height: 38, padding: '0 8px 0 16px', borderBottom: '1px solid var(--line)' }}>
      <Icon name={g.kind === 'upload' ? 'upload' : g.kind === 'download' ? 'download' : 'x'} label={DIR[g.kind]} style={{ color: 'var(--ink-muted)' }} />
      <div className="ell" style={{ color: 'var(--ink)' }}>
        {DIR[g.kind]} {g.label}
      </div>
      <ProgressBar value={pct} tone={g.state === 'done' ? 'success' : g.state === 'failed' ? 'danger' : 'accent'} ariaLabel={g.label} />
      <span className="ell" style={{ fontSize: 12, color: g.state === 'failed' ? 'var(--danger)' : 'var(--ink-muted)', textAlign: 'right' }}>
        {cap}
      </span>
      <Actions id={g.id} state={g.state} failed={g.failed > 0 && g.state !== 'active' && g.state !== 'queued'} />
    </div>
  )
}

export function TransfersPanel() {
  const open = useBrowser((s) => s.transfersOpen)
  const height = useBrowser((s) => s.transfersHeight)
  const tab = useBrowser((s) => s.transfersTab)
  const setOpen = useBrowser((s) => s.setTransfersOpen)
  const setTab = useBrowser((s) => s.setTransfersTab)
  const jobs = useTransfers((s) => s.jobs)
  const groups = useTransfers((s) => s.groups)
  const log = useTransfers((s) => s.log)
  const hosts = useApp((s) => s.hosts)

  const rows = useMemo(() => transferRows(jobs, groups), [jobs, groups])
  const all = Object.values(jobs)
  const active = all.filter((j) => j.state === 'active').length
  const queued = all.filter((j) => j.state === 'queued').length
  const paused = all.filter((j) => j.state === 'paused').length
  const speed = all.reduce((s, j) => s + (j.state === 'active' ? j.speedBps : 0), 0)
  const groupSpeed = (gid: string) => all.reduce((s, j) => s + (j.groupId === gid && j.state === 'active' ? j.speedBps : 0), 0)
  const hostName = (id: string) => hosts.find((h) => h.id === id)?.name ?? 'server'
  const summary = [active && `${active} active`, queued && `${queued} queued`, paused && `${paused} paused`, speed && formatSpeed(speed)].filter(Boolean).join(' · ') || 'Idle'

  return (
    <section aria-label="Transfers" style={{ flex: '0 0 auto', height: open ? height : 37, margin: '0 12px 12px', background: 'var(--bg-card)', borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div role="tablist" style={{ height: 36, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', borderBottom: '1px solid var(--line)' }}>
        <PaneTab icon="git-branch" active={tab === 'transfers'} closable={false} onSelect={() => (setTab('transfers'), setOpen(true))}>
          Transfers
        </PaneTab>
        <PaneTab icon="file" active={tab === 'log'} closable={false} onSelect={() => (setTab('log'), setOpen(true))}>
          Log
        </PaneTab>
        <span className="spacer" />
        <span style={{ fontSize: 12, color: 'var(--ink-muted)', marginRight: 8 }}>{summary}</span>
        {active || queued ? (
          <Button variant="ghost" size="sm" onClick={() => void invoke('transfers:pauseAll')}>
            Pause all
          </Button>
        ) : paused ? (
          <Button variant="ghost" size="sm" onClick={() => void invoke('transfers:resumeAll')}>
            Resume all
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => void invoke('transfers:clearDone')}>
          Clear completed
        </Button>
        <Button variant="ghost" size="sm" icon={open ? 'chevron-down' : 'chevron-up'} iconOnly onClick={() => setOpen(!open)}>
          {open ? 'Collapse transfers' : 'Expand transfers'}
        </Button>
      </div>
      {open ? (
        <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}>
          {tab === 'transfers' ? (
            rows.length ? (
              rows.map((r) => (r.isGroup ? <GroupRow key={r.id} g={r.group!} speed={groupSpeed(r.id)} /> : <JobRow key={r.id} j={r.job!} hostName={hostName(r.job!.hostId)} />))
            ) : (
              <div style={{ padding: '12px 16px', color: 'var(--ink-subtle)' }}>No transfers yet. Right-click a file to upload, download or sync it.</div>
            )
          ) : log.length ? (
            [...log].reverse().map((e, i) => (
              <div key={i} className="mono" style={{ display: 'flex', gap: 12, padding: '4px 16px', color: e.level === 'error' ? 'var(--danger)' : 'var(--ink-muted)' }}>
                <span style={{ color: 'var(--ink-subtle)', flex: '0 0 auto' }}>{formatClock(e.at)}</span>
                <span style={{ overflowWrap: 'anywhere' }}>{e.message}</span>
              </div>
            ))
          ) : (
            <div style={{ padding: '12px 16px', color: 'var(--ink-subtle)' }}>Nothing logged yet</div>
          )}
        </div>
      ) : null}
    </section>
  )
}
