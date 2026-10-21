import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { shell } from 'electron'
import type { EnqueueRequest, FsEntry, ProgressBatch, TransferGroup, TransferJob, TransferLogEntry, TransferState } from '@shared/types'
import { id } from '@shared/ids'
import { basename, posixDirname, posixJoin, relativeTo } from '@shared/paths'
import { formatBytes } from '@shared/format'
import type { ConnectionManager } from '../remote/ConnectionManager'
import type { Prompter } from '../remote/Prompter'
import type { StoredHost } from '../store/schema'
import { JsonStore } from '../store/JsonStore'
import { RemoteFsError, toRemoteFsError } from '../remote/errors'
import type { RemoteFs } from '../remote/RemoteFs'
import { concurrencyOf, isExcludedLocal, isExcludedRemote } from '../hostUtils'
import { emit } from '../events'
import { SpeedMeter } from './speed'
import { walkLocal, walkRemote } from './walk'

const FINISHED: TransferState[] = ['done', 'failed', 'canceled']
const KEEP_DONE = 200
const LOG_MAX = 300

export interface QueueDeps {
  conns: ConnectionManager
  prompter: Prompter
  getHost(id: string): StoredHost | undefined
  home: string
  file: string
  defaultConcurrency(): number
  /** Returns a reason when uploading would overwrite a remote change the user hasn't seen. */
  overwriteReason?(host: StoredHost, localPath: string, local: { mtime: number; size: number }, remote: FsEntry): string | null
  onJobDone?(job: TransferJob, host: StoredHost): void
  onJobFailed?(job: TransferJob, host: StoredHost): void
}

interface Running {
  ac: AbortController
  reason: 'cancel' | 'pause' | null
  meter: SpeedMeter
}

export class TransferQueue {
  private jobs = new Map<string, TransferJob>()
  private groups = new Map<string, TransferGroup>()
  private running = new Map<string, Running>()
  private dirty = new Set<string>()
  private changed = new Set<string>()
  private changedGroups = new Set<string>()
  private log: TransferLogEntry[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private paused = false
  private persist: JsonStore<{ jobs: TransferJob[]; groups: TransferGroup[] }>
  private connectTried = new Set<string>()

  constructor(private readonly deps: QueueDeps) {
    this.persist = new JsonStore(deps.file, () => ({ jobs: [], groups: [] }))
    const saved = this.persist.get()
    for (const g of saved.groups ?? []) this.groups.set(g.id, g)
    for (const j of saved.jobs ?? []) {
      this.jobs.set(j.id, { ...j, state: j.state === 'active' || j.state === 'queued' ? 'paused' : j.state, speedBps: 0 })
    }

    deps.conns.on('connected', (hostId: string) => {
      this.connectTried.delete(hostId)
      // Resume jobs that were interrupted by a dropped connection.
      for (const j of this.jobs.values()) {
        if (j.hostId === hostId && j.state === 'paused' && j.error === 'Waiting for connection') this.patch(j, { state: 'queued', error: undefined })
      }
      this.tick()
    })
    deps.conns.on('state', (s: { hostId: string; state: string; error?: string }) => {
      if (s.state === 'auth-failed' || s.state === 'error') {
        for (const j of this.jobs.values()) {
          if (j.hostId === s.hostId && (j.state === 'queued' || (j.state === 'paused' && j.error === 'Waiting for connection'))) {
            this.patch(j, { state: 'failed', error: s.error ?? 'Connection failed' })
            this.notifyFailed(j)
          }
        }
        this.flush()
      }
    })
  }

  /* ---------------- snapshot for the renderer ---------------- */

  snapshot(): { jobs: TransferJob[]; groups: TransferGroup[]; log: TransferLogEntry[] } {
    return { jobs: [...this.jobs.values()], groups: [...this.groups.values()], log: this.log }
  }

  private addLog(level: TransferLogEntry['level'], message: string): void {
    const e = { at: Date.now(), level, message }
    this.log.push(e)
    if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX)
    emit('transfers:log', e)
  }

  /* ---------------- enqueue ---------------- */

  async enqueue(reqs: EnqueueRequest[]): Promise<TransferJob[]> {
    const created: TransferJob[] = []
    for (const r of reqs) {
      const host = this.deps.getHost(r.hostId)
      if (!host) throw new RemoteFsError('ENOENT', 'Host not found')
      try {
        created.push(...(await this.expand(r, host)))
      } catch (e) {
        const err = toRemoteFsError(e)
        this.addLog('error', `${r.kind} ${basename(r.localPath || r.remotePath)}: ${err.detail}`)
        throw err
      }
    }
    this.flush()
    this.tick()
    return created
  }

  private newJob(r: Partial<TransferJob> & Pick<TransferJob, 'kind' | 'hostId' | 'localPath' | 'remotePath'>): TransferJob {
    const j: TransferJob = { id: id('tj'), size: 0, bytes: 0, state: 'queued', attempt: 0, speedBps: 0, source: 'manual', createdAt: Date.now(), ...r }
    this.jobs.set(j.id, j)
    this.changed.add(j.id)
    return j
  }

  private newGroup(kind: TransferGroup['kind'], hostId: string, label: string): TransferGroup {
    const g: TransferGroup = { id: id('tg'), kind, hostId, label, total: 0, done: 0, failed: 0, size: 0, bytes: 0, state: 'queued' }
    this.groups.set(g.id, g)
    this.changedGroups.add(g.id)
    return g
  }

  private async expand(r: EnqueueRequest, host: StoredHost): Promise<TransferJob[]> {
    const source = r.source ?? 'manual'
    const home = this.deps.home
    const exLocal = (p: string, d: boolean) => isExcludedLocal(host, p, d, home)
    const exRemote = (p: string, d: boolean) => isExcludedRemote(host, p, d, home)

    if (r.kind === 'delete-local') {
      return [this.newJob({ kind: 'delete-local', hostId: r.hostId, localPath: r.localPath, remotePath: r.remotePath, source })]
    }

    if (r.kind === 'upload') {
      const st = await stat(r.localPath)
      if (!st.isDirectory()) {
        if (!r.force && source !== 'sync' && host.behavior.compareBeforeOverwrite && this.deps.overwriteReason) {
          const fs = await this.deps.conns.get(r.hostId)
          const remote = await fs.stat(r.remotePath).catch(() => null)
          const reason = remote && remote.type === 'file' ? this.deps.overwriteReason(host, r.localPath, { mtime: st.mtimeMs, size: st.size }, remote) : null
          if (reason) {
            const a = await this.deps.prompter.ask({ kind: 'overwrite', hostId: host.id, hostName: host.name, localPath: r.localPath, remotePath: r.remotePath, reason })
            if (a.kind !== 'overwrite' || a.choice === 'cancel') return []
            if (a.choice === 'compare') {
              emit('app:openCompare', { hostId: host.id, localPath: r.localPath, remotePath: r.remotePath })
              return []
            }
          }
        }
        return [this.newJob({ kind: 'upload', hostId: r.hostId, localPath: r.localPath, remotePath: r.remotePath, size: st.size, source })]
      }
      const w = await walkLocal(r.localPath, exLocal)
      const g = this.newGroup('upload', host.id, `${basename(r.localPath)}/`)
      const jobs: TransferJob[] = []
      for (const d of w.dirs) {
        const rel = relativeTo(r.localPath, d.path) ?? ''
        jobs.push(this.newJob({ kind: 'mkdir-remote', hostId: host.id, localPath: d.path, remotePath: rel ? posixJoin(r.remotePath, rel) : r.remotePath, groupId: g.id, phase: 0, source }))
      }
      for (const f of w.files) {
        const rel = relativeTo(r.localPath, f.path) ?? basename(f.path)
        jobs.push(this.newJob({ kind: 'upload', hostId: host.id, localPath: f.path, remotePath: posixJoin(r.remotePath, rel), size: f.size, groupId: g.id, phase: 1, source }))
      }
      this.finishGroupSetup(g, jobs, w.files.length)
      return jobs
    }

    const fs = await this.deps.conns.get(r.hostId)
    const rst = await fs.stat(r.remotePath)

    if (r.kind === 'download') {
      if (rst.type !== 'dir') return [this.newJob({ kind: 'download', hostId: r.hostId, localPath: r.localPath, remotePath: r.remotePath, size: rst.size, source })]
      const w = await walkRemote(fs, r.remotePath, exRemote)
      const g = this.newGroup('download', host.id, `${basename(r.remotePath)}/`)
      const jobs: TransferJob[] = []
      for (const d of w.dirs) {
        const rel = relativeTo(r.remotePath, d.path) ?? ''
        jobs.push(this.newJob({ kind: 'mkdir-local', hostId: host.id, localPath: rel ? `${r.localPath}/${rel}` : r.localPath, remotePath: d.path, groupId: g.id, phase: 0, source }))
      }
      for (const f of w.files) {
        const rel = relativeTo(r.remotePath, f.path) ?? basename(f.path)
        jobs.push(this.newJob({ kind: 'download', hostId: host.id, localPath: `${r.localPath}/${rel}`, remotePath: f.path, size: f.size, groupId: g.id, phase: 1, source }))
      }
      this.finishGroupSetup(g, jobs, w.files.length)
      return jobs
    }

    // delete-remote
    if (rst.type !== 'dir') return [this.newJob({ kind: 'delete-remote', hostId: r.hostId, localPath: r.localPath, remotePath: r.remotePath, source })]
    // Deleting walks without excludes: the whole directory goes.
    const w = await walkRemote(fs, r.remotePath, () => false)
    const g = this.newGroup('delete-remote', host.id, `${basename(r.remotePath)}/`)
    const maxDepth = Math.max(0, ...w.dirs.map((d) => d.depth))
    const jobs: TransferJob[] = []
    for (const f of w.files) jobs.push(this.newJob({ kind: 'delete-remote', hostId: host.id, localPath: '', remotePath: f.path, groupId: g.id, phase: 0, source }))
    for (const d of w.dirs) jobs.push(this.newJob({ kind: 'delete-remote', hostId: host.id, localPath: '', remotePath: d.path, size: -1, groupId: g.id, phase: 1 + maxDepth - d.depth, source }))
    this.finishGroupSetup(g, jobs, w.files.length + w.dirs.length)
    return jobs
  }

  private finishGroupSetup(g: TransferGroup, jobs: TransferJob[], count: number): void {
    g.total = jobs.length
    g.size = jobs.reduce((s, j) => s + Math.max(0, j.size), 0)
    g.label = `${g.label} · ${count} item${count === 1 ? '' : 's'}${g.size ? ' · ' + formatBytes(g.size) : ''}`
    this.changedGroups.add(g.id)
  }

  /* ---------------- controls ---------------- */

  private expandIds(ids: string[]): TransferJob[] {
    const out: TransferJob[] = []
    for (const i of ids) {
      const j = this.jobs.get(i)
      if (j) out.push(j)
      else if (this.groups.has(i)) for (const c of this.jobs.values()) if (c.groupId === i) out.push(c)
    }
    return out
  }

  cancel(ids: string[]): void {
    for (const j of this.expandIds(ids)) {
      const r = this.running.get(j.id)
      if (r) {
        r.reason = 'cancel'
        r.ac.abort()
      } else if (!FINISHED.includes(j.state)) this.patch(j, { state: 'canceled', speedBps: 0 })
    }
    this.flush()
    this.tick()
  }

  pause(ids: string[]): void {
    for (const j of this.expandIds(ids)) {
      const r = this.running.get(j.id)
      if (r) {
        r.reason = 'pause'
        r.ac.abort()
      } else if (j.state === 'queued') this.patch(j, { state: 'paused' })
    }
    this.flush()
  }

  resume(ids: string[]): void {
    for (const j of this.expandIds(ids)) if (j.state === 'paused') this.patch(j, { state: 'queued', error: undefined })
    this.flush()
    this.tick()
  }

  retry(ids: string[], restart = false): void {
    for (const j of this.expandIds(ids)) {
      if (j.state === 'failed' || j.state === 'canceled' || j.state === 'paused') {
        this.patch(j, { state: 'queued', error: undefined, attempt: j.attempt + 1, bytes: restart ? 0 : j.bytes })
      }
    }
    this.flush()
    this.tick()
  }

  remove(ids: string[]): void {
    const removed: string[] = []
    for (const j of this.expandIds(ids)) {
      const r = this.running.get(j.id)
      if (r) {
        r.reason = 'cancel'
        r.ac.abort()
      }
      this.jobs.delete(j.id)
      removed.push(j.id)
    }
    for (const i of ids) if (this.groups.delete(i)) removed.push(i)
    this.flush(removed)
  }

  pauseAll(): void {
    this.paused = true
    this.pause([...this.jobs.values()].filter((j) => j.state === 'active' || j.state === 'queued').map((j) => j.id))
  }

  resumeAll(): void {
    this.paused = false
    this.resume([...this.jobs.values()].filter((j) => j.state === 'paused').map((j) => j.id))
  }

  isPaused(): boolean {
    return this.paused
  }

  clearDone(): void {
    const removed: string[] = []
    for (const j of this.jobs.values()) if (j.state === 'done' || j.state === 'canceled') removed.push(j.id)
    for (const r of removed) this.jobs.delete(r)
    for (const g of this.groups.values()) {
      if (![...this.jobs.values()].some((j) => j.groupId === g.id)) {
        this.groups.delete(g.id)
        removed.push(g.id)
      }
    }
    this.flush(removed)
  }

  /** Fail/cancel everything for a host that is being deleted. */
  dropHost(hostId: string): void {
    this.remove([...this.jobs.values()].filter((j) => j.hostId === hostId).map((j) => j.id))
  }

  /* ---------------- scheduler ---------------- */

  private canRun(j: TransferJob): boolean {
    if (j.groupId == null || j.phase == null) return true
    for (const o of this.jobs.values()) {
      if (o.groupId === j.groupId && o !== j && (o.phase ?? 0) < j.phase && !FINISHED.includes(o.state)) return false
    }
    return true
  }

  tick(): void {
    if (this.paused) return
    const activeBy = new Map<string, number>()
    for (const j of this.jobs.values()) if (j.state === 'active') activeBy.set(j.hostId, (activeBy.get(j.hostId) ?? 0) + 1)

    for (const j of this.jobs.values()) {
      if (j.state !== 'queued') continue
      const host = this.deps.getHost(j.hostId)
      if (!host) continue
      const local = j.kind === 'delete-local' || j.kind === 'mkdir-local'
      if (!local && !this.deps.conns.isConnected(j.hostId)) {
        const st = this.deps.conns.state(j.hostId).state
        if ((st === 'disconnected' || st === 'error') && !this.connectTried.has(j.hostId)) {
          this.connectTried.add(j.hostId)
          void this.deps.conns.connect(j.hostId, { interactive: true }).catch(() => undefined)
        }
        continue
      }
      const limit = concurrencyOf(host, this.deps.defaultConcurrency())
      const active = activeBy.get(j.hostId) ?? 0
      if (active >= limit) continue
      if (!this.canRun(j)) continue
      activeBy.set(j.hostId, active + 1)
      void this.run(j, host, limit)
    }
  }

  private async run(job: TransferJob, host: StoredHost, limit: number): Promise<void> {
    const startBytes = job.kind === 'upload' || job.kind === 'download' ? job.bytes : 0
    const r: Running = { ac: new AbortController(), reason: null, meter: new SpeedMeter(startBytes) }
    this.running.set(job.id, r)
    this.patch(job, { state: 'active', startedAt: Date.now(), error: undefined })
    this.flush()

    let lease: { fs: RemoteFs; release: () => void } | null = null
    let startAt = 0
    try {
      const needsRemote = job.kind !== 'delete-local' && job.kind !== 'mkdir-local'
      if (needsRemote) lease = await this.deps.conns.acquire(job.hostId, limit)
      const fs = lease?.fs
      const onProgress = (bytes: number) => {
        job.bytes = bytes
        job.speedBps = r.meter.update(bytes)
        this.dirty.add(job.id)
        this.scheduleProgress()
      }

      switch (job.kind) {
        case 'upload': {
          const st = await stat(job.localPath)
          job.size = st.size
          if (job.bytes > 0 && job.bytes < st.size) {
            const remote = await fs!.stat(job.remotePath).catch(() => null)
            startAt = remote && remote.size === job.bytes ? job.bytes : 0
          }
          if (!job.groupId) await fs!.mkdir(posixDirname(job.remotePath), true)
          const mode = host.behavior.preservePermissions ? st.mode & 0o777 : undefined
          await fs!.upload(job.localPath, job.remotePath, { signal: r.ac.signal, onProgress, startAt, mode })
          break
        }
        case 'download': {
          if (job.bytes > 0) {
            const local = await stat(job.localPath).catch(() => null)
            startAt = local && local.size === job.bytes ? job.bytes : 0
          }
          await mkdir(dirname(job.localPath), { recursive: true })
          await fs!.download(job.remotePath, job.localPath, { signal: r.ac.signal, onProgress, startAt })
          if (host.behavior.preservePermissions) {
            const remote = await fs!.stat(job.remotePath).catch(() => null)
            if (remote?.mode) await import('node:fs/promises').then((m) => m.chmod(job.localPath, remote.mode! & 0o777)).catch(() => undefined)
          }
          break
        }
        case 'delete-remote':
          if (job.size === -1) await fs!.deleteDir(job.remotePath)
          else {
            const st = await fs!.stat(job.remotePath).catch((e) => {
              if (toRemoteFsError(e).code === 'ENOENT') return null
              throw e
            })
            if (st?.type === 'dir') {
              // Single directory: delete its (already empty) self.
              await fs!.deleteDir(job.remotePath)
            } else if (st) await fs!.deleteFile(job.remotePath)
          }
          break
        case 'mkdir-remote':
          await fs!.mkdir(job.remotePath, true)
          break
        case 'mkdir-local':
          await mkdir(job.localPath, { recursive: true })
          break
        case 'delete-local':
          try {
            await shell.trashItem(job.localPath)
          } catch {
            await rm(job.localPath, { recursive: true, force: true })
          }
          break
      }
      this.patch(job, { state: 'done', bytes: Math.max(job.size, 0), speedBps: 0, finishedAt: Date.now() })
      if (!job.groupId) this.addLog('info', `${verb(job)} ${basename(job.localPath || job.remotePath)}${job.size > 0 ? ' · ' + formatBytes(job.size) : ''}`)
      this.deps.onJobDone?.(job, host)
    } catch (e) {
      const err = toRemoteFsError(e)
      if (r.reason === 'cancel') {
        this.patch(job, { state: 'canceled', speedBps: 0, finishedAt: Date.now() })
        if (job.kind === 'download' && !startAt) await rm(job.localPath, { force: true }).catch(() => undefined)
      } else if (r.reason === 'pause') {
        this.patch(job, { state: 'paused', speedBps: 0 })
      } else if (err.code === 'ECONN') {
        this.patch(job, { state: 'paused', speedBps: 0, error: 'Waiting for connection' })
      } else {
        this.patch(job, { state: 'failed', speedBps: 0, error: err.detail, finishedAt: Date.now() })
        this.addLog('error', `${job.kind.replace('-', ' ')} ${basename(job.localPath || job.remotePath)} failed: ${err.detail}`)
        this.notifyFailed(job)
      }
    } finally {
      lease?.release()
      this.running.delete(job.id)
      this.prune()
      this.flush()
      this.tick()
    }
  }

  private notifyFailed(job: TransferJob): void {
    const host = this.deps.getHost(job.hostId)
    if (host) this.deps.onJobFailed?.(job, host)
  }

  /* ---------------- state + events ---------------- */

  private patch(j: TransferJob, p: Partial<TransferJob>): void {
    Object.assign(j, p)
    this.changed.add(j.id)
    if (j.groupId) this.changedGroups.add(j.groupId)
  }

  private recomputeGroup(g: TransferGroup): void {
    let done = 0
    let failed = 0
    let bytes = 0
    let active = 0
    let queued = 0
    let paused = 0
    let canceled = 0
    for (const j of this.jobs.values()) {
      if (j.groupId !== g.id) continue
      if (j.state === 'done') done++
      else if (j.state === 'failed') failed++
      else if (j.state === 'active') active++
      else if (j.state === 'queued') queued++
      else if (j.state === 'paused') paused++
      else if (j.state === 'canceled') canceled++
      bytes += j.state === 'done' ? Math.max(0, j.size) : j.bytes
    }
    g.done = done
    g.failed = failed
    g.bytes = bytes
    g.state = active ? 'active' : queued ? 'queued' : paused ? 'paused' : failed ? 'failed' : canceled && !done ? 'canceled' : 'done'
  }

  private prune(): void {
    const done = [...this.jobs.values()].filter((j) => !j.groupId && FINISHED.includes(j.state))
    if (done.length <= KEEP_DONE) return
    done.sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
    const removed = done.slice(0, done.length - KEEP_DONE).map((j) => j.id)
    for (const r of removed) this.jobs.delete(r)
    this.flush(removed)
  }

  private scheduleProgress(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      if (!this.dirty.size) return
      const batch: ProgressBatch = { jobs: [], groups: [] }
      const gs = new Set<string>()
      for (const i of this.dirty) {
        const j = this.jobs.get(i)
        if (!j) continue
        batch.jobs.push({ id: j.id, bytes: j.bytes, speedBps: j.speedBps })
        if (j.groupId) gs.add(j.groupId)
      }
      for (const gid of gs) {
        const g = this.groups.get(gid)
        if (!g) continue
        this.recomputeGroup(g)
        batch.groups.push({ id: g.id, bytes: g.bytes, done: g.done })
      }
      this.dirty.clear()
      emit('transfers:progress', batch)
    }, 100)
  }

  private flush(removed?: string[]): void {
    if (!this.changed.size && !this.changedGroups.size && !removed?.length) return
    const jobs = [...this.changed].map((i) => this.jobs.get(i)).filter((j): j is TransferJob => !!j)
    for (const gid of this.changedGroups) {
      const g = this.groups.get(gid)
      if (g) this.recomputeGroup(g)
    }
    const groups = [...this.changedGroups].map((i) => this.groups.get(i)).filter((g): g is TransferGroup => !!g)
    this.changed.clear()
    this.changedGroups.clear()
    emit('transfers:update', { jobs, groups, removed })
    this.persist.set({
      jobs: [...this.jobs.values()].filter((j) => !FINISHED.includes(j.state) || j.state === 'failed'),
      groups: [...this.groups.values()].filter((g) => g.state !== 'done')
    })
  }

  shutdown(): void {
    for (const r of this.running.values()) {
      r.reason = 'pause'
      r.ac.abort()
    }
    this.persist.set({
      jobs: [...this.jobs.values()].map((j) => (j.state === 'active' ? { ...j, state: 'paused' as const } : j)).filter((j) => !FINISHED.includes(j.state) || j.state === 'failed'),
      groups: [...this.groups.values()].filter((g) => g.state !== 'done')
    })
    this.persist.flush()
  }
}

function verb(j: TransferJob): string {
  switch (j.kind) {
    case 'upload':
      return 'Uploaded'
    case 'download':
      return 'Downloaded'
    case 'delete-remote':
      return 'Deleted on server'
    case 'delete-local':
      return 'Moved to Trash'
    default:
      return 'Created'
  }
}
