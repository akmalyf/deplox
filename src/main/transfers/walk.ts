import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { RemoteFs } from '../remote/RemoteFs'

export interface WalkResult {
  dirs: { path: string; depth: number }[]
  files: { path: string; size: number; mtime: number; mode?: number; depth: number }[]
  skipped: number
}

/** Breadth-first walk of a local directory (root included in `dirs`). Symlinks are skipped. */
export async function walkLocal(root: string, isExcluded: (absPath: string, isDir: boolean) => boolean): Promise<WalkResult> {
  const out: WalkResult = { dirs: [{ path: root, depth: 0 }], files: [], skipped: 0 }
  let level: string[] = [root]
  let depth = 0
  while (level.length) {
    const next: string[] = []
    depth++
    for (const dir of level) {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        const p = join(dir, e.name)
        if (e.isSymbolicLink()) {
          out.skipped++
          continue
        }
        const isDir = e.isDirectory()
        if (isExcluded(p, isDir)) continue
        if (isDir) {
          out.dirs.push({ path: p, depth })
          next.push(p)
        } else if (e.isFile()) {
          const st = await stat(p)
          out.files.push({ path: p, size: st.size, mtime: st.mtimeMs, mode: st.mode & 0o777, depth })
        }
      }
    }
    level = next
  }
  return out
}

/** Directory listings in flight at once. SFTP pipelines them over one channel; FTP queues them on its control connection. */
const REMOTE_LIST_CONCURRENCY = 8

export async function walkRemote(fs: RemoteFs, root: string, isExcluded: (absPath: string, isDir: boolean) => boolean): Promise<WalkResult> {
  const out: WalkResult = { dirs: [{ path: root, depth: 0 }], files: [], skipped: 0 }
  let level: string[] = [root]
  let depth = 0
  while (level.length) {
    const next: string[] = []
    depth++
    // One round trip per folder adds up fast on a remote link, so a level's folders are listed in parallel.
    const listings: Awaited<ReturnType<RemoteFs['list']>>[] = new Array(level.length)
    let cursor = 0
    const worker = async () => {
      while (cursor < level.length) {
        const i = cursor++
        listings[i] = await fs.list(level[i])
      }
    }
    await Promise.all(Array.from({ length: Math.min(REMOTE_LIST_CONCURRENCY, level.length) }, worker))
    for (const entries of listings) {
      for (const e of entries) {
        if (e.type === 'symlink') {
          out.skipped++
          continue
        }
        const isDir = e.type === 'dir'
        if (isExcluded(e.path, isDir)) continue
        if (isDir) {
          out.dirs.push({ path: e.path, depth })
          next.push(e.path)
        } else out.files.push({ path: e.path, size: e.size, mtime: e.mtime, mode: e.mode, depth })
      }
    }
    level = next
  }
  return out
}
