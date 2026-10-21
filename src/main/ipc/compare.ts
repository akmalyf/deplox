import { readFile, stat, writeFile } from 'node:fs/promises'
import type { CompareSide } from '@shared/types'
import { looksBinary, splitText } from '@shared/compare'
import { handle } from './register'
import type { Services } from '../services'
import { RemoteFsError, toRemoteFsError } from '../remote/errors'

const MAX = 4 * 1000 * 1000
const decoder = new TextDecoder('utf-8', { fatal: true })

function decode(buf: Buffer, label: string): string {
  if (looksBinary(buf)) throw new RemoteFsError('EBINARY', `${label} is a binary file`)
  try {
    return decoder.decode(buf)
  } catch {
    throw new RemoteFsError('EBINARY', `${label} is not valid UTF-8`)
  }
}

function side(text: string, mtime: number, size: number, exists: boolean): CompareSide {
  const sp = splitText(text)
  return { text, eol: sp.eol, bom: sp.bom, trailingNewline: sp.trailingNewline, mtime, size, exists }
}

export function registerCompare(s: Services): void {
  handle('compare:load', async ({ hostId, localPath, remotePath }) => {
    let local: CompareSide
    try {
      const st = await stat(localPath)
      if (st.size > MAX) throw new RemoteFsError('ETOOBIG', 'Local file is larger than 4 MB')
      local = side(decode(await readFile(localPath), 'Local file'), st.mtimeMs, st.size, true)
    } catch (e) {
      const err = toRemoteFsError(e)
      if (err.code !== 'ENOENT') throw err
      local = side('', 0, 0, false)
    }
    const fs = await s.conns.get(hostId)
    let remote: CompareSide
    let remoteNewer = false
    try {
      const st = await fs.stat(remotePath)
      const buf = await fs.readFile(remotePath, MAX)
      remote = side(decode(buf, 'Remote file'), st.mtime, st.size, true)
      if (local.exists) remoteNewer = s.snapshots.overwriteReason(hostId, remotePath, { mtime: local.mtime, size: local.size }, st) != null
    } catch (e) {
      const err = toRemoteFsError(e)
      if (err.code !== 'ENOENT') throw err
      remote = side('', 0, 0, false)
    }
    return { local, remote, remoteNewerThanSnapshot: remoteNewer }
  })

  handle('compare:writeRemote', async ({ hostId, path, text, expectedMtime, expectedSize, otherPath }) => {
    const fs = await s.conns.get(hostId)
    const cur = await fs.stat(path).catch((e) => {
      if (toRemoteFsError(e).code === 'ENOENT') return null
      throw e
    })
    const expectedExists = expectedMtime > 0 || expectedSize > 0
    if ((cur && !expectedExists) || (!cur && expectedExists) || (cur && (cur.mtime !== expectedMtime || cur.size !== expectedSize))) {
      throw new RemoteFsError('ESTALE', 'The remote file changed since it was loaded')
    }
    const host = s.getHost(hostId)
    if (!cur) await fs.mkdir(path.slice(0, path.lastIndexOf('/')) || '/', true)
    await fs.writeFile(path, Buffer.from(text, 'utf8'), host?.behavior.preservePermissions ? cur?.mode : undefined)
    const after = await fs.stat(path)
    if (otherPath) {
      const l = await stat(otherPath).catch(() => null)
      if (l) s.snapshots.set(hostId, path, { localMtime: l.mtimeMs, localSize: l.size, remoteMtime: after.mtime, remoteSize: after.size, syncedAt: Date.now() })
    }
    return { mtime: after.mtime, size: after.size }
  })

  handle('compare:writeLocal', async ({ hostId, path, text, expectedMtime, expectedSize, otherPath }) => {
    const cur = await stat(path).catch(() => null)
    const expectedExists = expectedMtime > 0 || expectedSize > 0
    if ((cur && !expectedExists) || (!cur && expectedExists) || (cur && (Math.abs(cur.mtimeMs - expectedMtime) > 1 || cur.size !== expectedSize))) {
      throw new RemoteFsError('ESTALE', 'The local file changed since it was loaded')
    }
    await writeFile(path, text, 'utf8')
    const after = await stat(path)
    if (hostId && otherPath) {
      const fs = await s.conns.get(hostId)
      const r = await fs.stat(otherPath).catch(() => null)
      if (r) s.snapshots.set(hostId, otherPath, { localMtime: after.mtimeMs, localSize: after.size, remoteMtime: r.mtime, remoteSize: r.size, syncedAt: Date.now() })
    }
    return { mtime: after.mtimeMs, size: after.size }
  })
}
