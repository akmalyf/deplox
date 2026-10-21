import { stat } from 'node:fs/promises'
import { watch, type FSWatcher } from 'chokidar'
import type { FsEntry, SyncItem, TransferJob } from '@shared/types'
import { formatClock, formatWhen } from '@shared/format'
import { normLocal, relativeTo, toLocalPath, toRemotePath, findMappingForLocal } from '@shared/paths'
import type { Host } from '@shared/types'
import type { StoredHost } from '../store/schema'
import type { ConnectionManager } from '../remote/ConnectionManager'
import type { TransferQueue } from '../transfers/TransferQueue'
import { walkLocal, walkRemote } from '../transfers/walk'
import { isExcludedLocal, isExcludedRemote, localRoots } from '../hostUtils'
import { emit, toast } from '../events'
import { toRemoteFsError } from '../remote/errors'
import type { Snapshots } from './snapshot'

interface LocalInfo {
  mtime: number
  size: number
}

export interface SyncDeps {
  conns: ConnectionManager
  queue: TransferQueue
  snapshots: Snapshots
  home: string
  hostsOf(projectId: string): StoredHost[]
  getHost(id: string): StoredHost | undefined
}

const itemId = (hostId: string, remotePath: string) => `${hostId}|${remotePath}`

/**
 * Detects pending work between local mappings and hosts:
 * - a chokidar watcher on the active project's mapping roots (local changes, upload on save)
 * - a full scan of both sides on demand (remote changes)
 * Classification compares both sides with the last-synced snapshot.
 */
export class SyncEngine {
  private items = new Map<string, SyncItem>()
  private watcher: FSWatcher | null = null
  private watchedProject: string | null = null
  private pending = new Map<string, NodeJS.Timeout>()
  private emitTimer: NodeJS.Timeout | null = null
  /** job id → sync item id */
  private jobItems = new Map<string, string>()

  constructor(private readonly deps: SyncDeps) {}

  list(): SyncItem[] {
    return [...this.items.values()]
  }

  private changed(): void {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      emit('sync:items', { items: this.list() })
    }, 80)
  }

  private put(item: SyncItem): void {
    this.items.set(item.id, item)
    this.changed()
  }

  private drop(id: string): void {
    if (this.items.delete(id)) this.changed()
  }

  /* ---------------- watcher ---------------- */

  async setWatching(projectId: string, on: boolean): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
      this.watchedProject = null
    }
    if (!on) return
    const hosts = this.deps.hostsOf(projectId)
    const roots = [...new Set(hosts.flatMap((h) => localRoots(h, this.deps.home)))]
    if (!roots.length) return
    this.watchedProject = projectId
    this.watcher = watch(roots, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      ignored: (p: string, stats?: { isDirectory(): boolean }) => {
        if (p.endsWith('.DS_Store')) return true
        const covering = hosts.filter((h) => findMappingForLocal(h as Host, p, this.deps.home))
        if (!covering.length) return false
        return covering.every((h) => isExcludedLocal(h, p, stats?.isDirectory() ?? false, this.deps.home))
      }
    })
    const onEvent = (p: string) => this.debounce(p)
    this.watcher.on('add', onEvent).on('change', onEvent).on('unlink', onEvent)
    this.watcher.on('error', (e) => console.error('[sync] watcher', e))
  }

  private debounce(abs: string): void {
    const t = this.pending.get(abs)
    if (t) clearTimeout(t)
    this.pending.set(
      abs,
      setTimeout(() => {
        this.pending.delete(abs)
        void this.onLocalChange(abs).catch((e) => console.error('[sync]', e))
      }, 500)
    )
  }

  private async onLocalChange(abs: string): Promise<void> {
    if (!this.watchedProject) return
    const local = await statLocal(abs)
    for (const host of this.deps.hostsOf(this.watchedProject)) {
      if (isExcludedLocal(host, abs, false, this.deps.home)) continue
      const remotePath = toRemotePath(host as Host, abs, this.deps.home)
      if (!remotePath) continue
      let remote: FsEntry | null | undefined = undefined
      if (this.deps.conns.isConnected(host.id)) {
        try {
          const fs = await this.deps.conns.get(host.id)
          remote = await fs.stat(remotePath).catch((e) => {
            if (toRemoteFsError(e).code === 'ENOENT') return null
            throw e
          })
        } catch {
          remote = undefined
        }
      }
      const item = this.classify(host, normLocal(abs), remotePath, local, remote, 'watch')
      if (!item) continue
      if (host.behavior.uploadOnSave && item.kind === 'upload' && local) {
        this.put({ ...item, reason: `Uploading on save · ${formatClock(Date.now())}` })
        await this.enqueue([item], 'save')
      } else if (host.behavior.uploadOnSave && item.kind === 'conflict') {
        toast(`${basenameOf(abs)} changed on ${host.name}: review it in Compare`, 'danger')
      }
    }
  }

  /* ---------------- classification ---------------- */

  /**
   * remote: entry, null (missing on server) or undefined (unknown: not connected).
   * Returns the stored item, or null when both sides are in sync.
   */
  private classify(host: StoredHost, localPath: string, remotePath: string, local: LocalInfo | null, remote: FsEntry | null | undefined, origin: 'watch' | 'scan'): SyncItem | null {
    const id = itemId(host.id, remotePath)
    const snap = this.deps.snapshots.get(host.id, remotePath)
    const prev = this.items.get(id)
    if (prev?.group === 'done') this.items.delete(id)
    const relRoot = host.mappings[0] ? relativeTo(normLocal(host.mappings[0].local.replace(/^~/, this.deps.home)), localPath) : null
    const relPath = relRoot ?? localPath
    const base = {
      id,
      projectId: host.projectId,
      hostId: host.id,
      relPath,
      localPath,
      remotePath,
      updatedAt: Date.now()
    }
    const lInfo = local ? `Modified ${formatWhen(local.mtime)}` : snap ? 'Deleted' : 'Not here'
    const rInfo = remote === undefined ? 'Unknown (not connected)' : remote ? `Modified ${formatWhen(remote.mtime)}` : 'Not on server'

    if (!local && remote === null) {
      this.drop(id)
      if (snap) this.deps.snapshots.delete(host.id, remotePath)
      return null
    }
    if (!local) {
      if (remote === undefined && !snap) {
        this.drop(id)
        return null
      }
      const item: SyncItem = snap
        ? { ...base, kind: 'delete-remote', size: remote?.size ?? snap.remoteSize, reason: `Deleted locally ${formatClock(Date.now())}`, localInfo: lInfo, remoteInfo: rInfo, group: 'wait' }
        : { ...base, kind: 'download', size: remote!.size, reason: 'Only on server', localInfo: 'Not downloaded', remoteInfo: rInfo, group: 'wait' }
      this.put(item)
      return item
    }
    if (remote === null) {
      const item: SyncItem = { ...base, kind: 'upload', size: local.size, reason: snap ? 'Missing on server' : 'New local file', localInfo: lInfo, remoteInfo: rInfo, group: 'wait' }
      this.put(item)
      return item
    }
    if (remote === undefined) {
      // Not connected: assume a plain upload, re-checked before it runs.
      if (snap && Math.abs(local.mtime - snap.localMtime) < 1000 && local.size === snap.localSize) {
        this.drop(id)
        return null
      }
      const item: SyncItem = { ...base, kind: 'upload', size: local.size, reason: `Saved locally ${formatClock(local.mtime)}`, localInfo: lInfo, remoteInfo: rInfo, group: 'wait' }
      this.put(item)
      return item
    }

    let localChanged: boolean
    let remoteChanged: boolean
    if (snap) {
      localChanged = Math.abs(local.mtime - snap.localMtime) >= 1000 || local.size !== snap.localSize
      remoteChanged = remote.mtime !== snap.remoteMtime || remote.size !== snap.remoteSize
    } else if (local.size === remote.size && origin === 'scan') {
      // Unknown history and same size: treat as in sync and remember it.
      this.deps.snapshots.set(host.id, remotePath, { localMtime: local.mtime, localSize: local.size, remoteMtime: remote.mtime, remoteSize: remote.size, syncedAt: Date.now() })
      this.drop(id)
      return null
    } else {
      localChanged = remote.mtime <= local.mtime + 2000
      remoteChanged = !localChanged
    }

    let item: SyncItem | null = null
    if (localChanged && remoteChanged) {
      item = { ...base, kind: 'conflict', size: local.size, reason: 'Changed on both sides', localInfo: lInfo, remoteInfo: rInfo, group: 'attn' }
    } else if (localChanged) {
      item = { ...base, kind: 'upload', size: local.size, reason: `Saved locally ${formatClock(local.mtime)}`, localInfo: lInfo, remoteInfo: rInfo, group: 'wait' }
    } else if (remoteChanged) {
      item = { ...base, kind: 'download', size: remote.size, reason: `Changed on server ${formatWhen(remote.mtime)}`, localInfo: lInfo, remoteInfo: rInfo, group: 'wait' }
    }
    if (item) this.put(item)
    else this.drop(id)
    return item
  }

  /* ---------------- scan ---------------- */

  async scan(projectId: string): Promise<SyncItem[]> {
    const errors: string[] = []
    for (const host of this.deps.hostsOf(projectId)) {
      for (const m of host.mappings) {
        const localRoot = normLocal(m.local.replace(/^~/, this.deps.home))
        try {
          const fs = await this.deps.conns.get(host.id)
          const [lw, rw] = await Promise.all([
            walkLocal(localRoot, (p, d) => isExcludedLocal(host, p, d, this.deps.home)).catch(() => ({ dirs: [], files: [], skipped: 0 })),
            walkRemote(fs, m.remote, (p, d) => isExcludedRemote(host, p, d, this.deps.home)).catch((e) => {
              if (toRemoteFsError(e).code === 'ENOENT') return { dirs: [], files: [], skipped: 0 }
              throw e
            })
          ])
          const remoteByPath = new Map(rw.files.map((f) => [f.path, f]))
          const seen = new Set<string>()
          for (const f of lw.files) {
            const lp = normLocal(f.path)
            const rp = toRemotePath(host as Host, lp, this.deps.home)
            if (!rp) continue
            seen.add(rp)
            const r = remoteByPath.get(rp)
            this.classify(host, lp, rp, { mtime: f.mtime, size: f.size }, r ? { name: '', path: rp, type: 'file', size: r.size, mtime: r.mtime } : null, 'scan')
          }
          for (const r of rw.files) {
            if (seen.has(r.path)) continue
            const lp = toLocalPath(host as Host, r.path, this.deps.home)
            if (!lp) continue
            this.classify(host, normLocal(lp), r.path, null, { name: '', path: r.path, type: 'file', size: r.size, mtime: r.mtime }, 'scan')
          }
        } catch (e) {
          errors.push(`${host.name}: ${toRemoteFsError(e).detail}`)
        }
      }
    }
    if (errors.length) toast(`Rescan incomplete · ${errors.join(' · ')}`, 'danger')
    return this.list()
  }

  /* ---------------- run ---------------- */

  private async enqueue(items: SyncItem[], source: 'sync' | 'save'): Promise<void> {
    for (const it of items) {
      const kind = it.kind === 'failed' ? it.action : it.kind
      if (kind !== 'upload' && kind !== 'download' && kind !== 'delete-remote') continue
      try {
        const jobs = await this.deps.queue.enqueue([{ kind, hostId: it.hostId, localPath: it.localPath, remotePath: it.remotePath, source, force: true }])
        for (const j of jobs) this.jobItems.set(j.id, it.id)
        this.put({ ...it, kind, group: 'wait', reason: source === 'save' ? it.reason : `Queued ${formatClock(Date.now())}`, updatedAt: Date.now() })
      } catch (e) {
        this.put({ ...it, kind: 'failed', action: kind, group: 'attn', reason: toRemoteFsError(e).detail, updatedAt: Date.now() })
      }
    }
  }

  async run(ids: string[]): Promise<void> {
    const ready: SyncItem[] = []
    for (const id of ids) {
      const it = this.items.get(id)
      if (!it || it.group === 'done' || it.kind === 'conflict') continue
      // Re-check uploads: the server may have changed since the item was queued.
      if (it.kind === 'upload' && this.deps.conns.isConnected(it.hostId)) {
        const host = this.deps.getHost(it.hostId)
        const local = await statLocal(it.localPath)
        if (host && local) {
          const fs = await this.deps.conns.get(it.hostId)
          const remote = await fs.stat(it.remotePath).catch(() => null)
          const fresh = this.classify(host, it.localPath, it.remotePath, local, remote, 'watch')
          if (!fresh || fresh.kind !== 'upload') continue
        }
      }
      ready.push(this.items.get(id) ?? it)
    }
    await this.enqueue(ready, 'sync')
  }

  async resolve(id: string, resolution: 'upload' | 'download'): Promise<void> {
    const it = this.items.get(id)
    if (!it) return
    await this.enqueue([{ ...it, kind: resolution }], 'sync')
  }

  remove(ids: string[]): void {
    for (const id of ids) this.drop(id)
  }

  clearDone(): void {
    for (const it of [...this.items.values()]) if (it.group === 'done') this.items.delete(it.id)
    this.changed()
  }

  dropHost(hostId: string): void {
    for (const it of [...this.items.values()]) if (it.hostId === hostId) this.items.delete(it.id)
    this.changed()
  }

  /* ---------------- queue callbacks ---------------- */

  async onJobDone(job: TransferJob, host: StoredHost): Promise<void> {
    if (job.kind !== 'upload' && job.kind !== 'download' && job.kind !== 'delete-remote') return
    // Record the synced state of the pair.
    try {
      if (job.kind === 'delete-remote') {
        this.deps.snapshots.delete(host.id, job.remotePath)
      } else {
        const local = await statLocal(job.localPath)
        const fs = await this.deps.conns.get(host.id)
        const remote = await fs.stat(job.remotePath)
        if (local) this.deps.snapshots.set(host.id, job.remotePath, { localMtime: local.mtime, localSize: local.size, remoteMtime: remote.mtime, remoteSize: remote.size, syncedAt: Date.now() })
      }
    } catch {
      /* snapshot is best effort */
    }
    const id = this.jobItems.get(job.id) ?? itemId(host.id, job.remotePath)
    this.jobItems.delete(job.id)
    const it = this.items.get(id)
    if (!it) {
      if (job.source === 'manual') return
    }
    const verb = job.kind === 'upload' ? 'Uploaded' : job.kind === 'download' ? 'Downloaded' : 'Deleted'
    const base = it ?? {
      id,
      projectId: host.projectId,
      hostId: host.id,
      relPath: basenameOf(job.localPath || job.remotePath),
      localPath: job.localPath,
      remotePath: job.remotePath,
      localInfo: '',
      remoteInfo: ''
    }
    if (job.source === 'manual' && it) {
      // A manual transfer resolved this item.
      this.drop(id)
      return
    }
    this.put({ ...base, kind: job.kind, size: job.size, group: 'done', reason: `${verb} ${formatClock(Date.now())}`, localInfo: base.localInfo, remoteInfo: `${verb} ${formatClock(Date.now())}`, updatedAt: Date.now() } as SyncItem)
  }

  onJobFailed(job: TransferJob, host: StoredHost): void {
    if (job.source === 'manual') return
    if (job.kind !== 'upload' && job.kind !== 'download' && job.kind !== 'delete-remote') return
    const id = this.jobItems.get(job.id) ?? itemId(host.id, job.remotePath)
    const it = this.items.get(id)
    this.put({
      ...(it ?? {
        id,
        projectId: host.projectId,
        hostId: host.id,
        relPath: basenameOf(job.localPath || job.remotePath),
        localPath: job.localPath,
        remotePath: job.remotePath,
        localInfo: '',
        remoteInfo: 'Unknown'
      }),
      kind: 'failed',
      action: job.kind,
      size: job.size,
      group: 'attn',
      reason: job.error ?? 'Failed',
      updatedAt: Date.now()
    } as SyncItem)
  }

  async close(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
  }
}

async function statLocal(p: string): Promise<LocalInfo | null> {
  try {
    const st = await stat(p)
    return st.isFile() ? { mtime: st.mtimeMs, size: st.size } : null
  } catch {
    return null
  }
}

function basenameOf(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() ?? p
}

