import { mkdir, readdir, rename, stat, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { shell } from 'electron'
import type { FsEntry } from '@shared/types'
import { basename } from '@shared/paths'
import { handle } from './register'
import type { Services } from '../services'
import { toRemoteFsError } from '../remote/errors'

async function entry(p: string, name?: string): Promise<FsEntry> {
  const l = await lstat(p)
  let type: FsEntry['type'] = l.isDirectory() ? 'dir' : l.isSymbolicLink() ? 'symlink' : 'file'
  let size = l.size
  let mtime = l.mtimeMs
  if (type === 'symlink') {
    try {
      const t = await stat(p)
      type = t.isDirectory() ? 'dir' : 'file'
      size = t.size
      mtime = t.mtimeMs
    } catch {
      /* dangling */
    }
  }
  return { name: name ?? basename(p), path: p, type, size, mtime, mode: l.mode & 0o7777 }
}

export function registerFs(s: Services): void {
  handle('local:home', () => s.home)

  handle('local:list', async (dir) => {
    const d = dir.replace(/^~/, s.home)
    const names = await readdir(d)
    const out = await Promise.all(names.filter((n) => n !== '.DS_Store').map((n) => entry(join(d, n), n).catch(() => null)))
    return out.filter((x): x is FsEntry => !!x)
  })

  handle('local:stat', async (p) => {
    try {
      return await entry(p.replace(/^~/, s.home))
    } catch (e) {
      if (toRemoteFsError(e).code === 'ENOENT') return null
      throw e
    }
  })

  handle('local:mkdir', async (p) => {
    await mkdir(p, { recursive: false })
  })

  handle('local:rename', async ({ from, to }) => {
    await rename(from, to)
  })

  handle('local:delete', async (p) => {
    await shell.trashItem(p)
  })

  handle('remote:list', async ({ hostId, path }) => (await s.conns.get(hostId)).list(path))

  handle('remote:stat', async ({ hostId, path }) => {
    const fs = await s.conns.get(hostId)
    try {
      return await fs.stat(path)
    } catch (e) {
      if (toRemoteFsError(e).code === 'ENOENT') return null
      throw e
    }
  })

  handle('remote:mkdir', async ({ hostId, path }) => (await s.conns.get(hostId)).mkdir(path, false))
  handle('remote:rename', async ({ hostId, from, to }) => (await s.conns.get(hostId)).rename(from, to))
  handle('remote:realpath', async ({ hostId, path }) => (await s.conns.get(hostId)).realpath(path))

  handle('remote:delete', async ({ hostId, path }) => {
    await s.queue.enqueue([{ kind: 'delete-remote', hostId, localPath: '', remotePath: path }])
  })
}
