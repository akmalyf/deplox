import type { FsEntry } from '@shared/types'
import { formatWhen } from '@shared/format'
import { JsonStore } from '../store/JsonStore'

export interface Snap {
  localMtime: number
  localSize: number
  remoteMtime: number
  remoteSize: number
  syncedAt: number
}

/** Last-synced state per host + remote path; the base for change detection. */
export class Snapshots {
  private readonly store: JsonStore<Record<string, Record<string, Snap>>>

  constructor(file: string) {
    this.store = new JsonStore(file, () => ({}), undefined, 1000)
  }

  get(hostId: string, remotePath: string): Snap | undefined {
    return this.store.get()[hostId]?.[remotePath]
  }

  set(hostId: string, remotePath: string, snap: Snap): void {
    this.store.update((s) => ({ ...s, [hostId]: { ...(s[hostId] ?? {}), [remotePath]: snap } }))
  }

  delete(hostId: string, remotePath: string): void {
    const h = this.store.get()[hostId]
    if (!h?.[remotePath]) return
    this.store.update((s) => {
      const next = { ...(s[hostId] ?? {}) }
      delete next[remotePath]
      return { ...s, [hostId]: next }
    })
  }

  dropHost(hostId: string): void {
    this.store.update((s) => {
      const next = { ...s }
      delete next[hostId]
      return next
    })
  }

  flush(): void {
    this.store.flush()
  }

  /** Why an upload would clobber a remote change, or null. */
  overwriteReason(hostId: string, remotePath: string, local: { mtime: number; size: number }, remote: FsEntry): string | null {
    const snap = this.get(hostId, remotePath)
    if (snap) {
      if (remote.mtime !== snap.remoteMtime || remote.size !== snap.remoteSize) {
        return `The server copy changed ${formatWhen(remote.mtime)}, after your last sync`
      }
      return null
    }
    if (remote.mtime > local.mtime + 2000 && remote.size !== local.size) {
      return `The server copy (${formatWhen(remote.mtime)}) is newer than your local file`
    }
    return null
  }
}
