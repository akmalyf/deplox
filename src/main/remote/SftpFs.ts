import { createReadStream, createWriteStream } from 'node:fs'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Client, SFTPWrapper, Stats } from 'ssh2'
import type { FsEntry } from '@shared/types'
import { basename, posixDirname, posixJoin, posixNormalize } from '@shared/paths'
import type { RemoteFs, TransferControl } from './RemoteFs'
import { RemoteFsError, toRemoteFsError } from './errors'

function p<T>(fn: (cb: (err: Error | null | undefined, v: T) => void) => void, ctx: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    fn((err, v) => (err ? reject(toRemoteFsError(err, ctx)) : resolve(v)))
  })
}

function entryType(a: Stats): FsEntry['type'] {
  if (a.isDirectory()) return 'dir'
  if (a.isSymbolicLink()) return 'symlink'
  return 'file'
}

export function counter(start: number, onProgress: (n: number) => void): Transform {
  let total = start
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length
      onProgress(total)
      cb(null, chunk)
    }
  })
}

export class SftpFs implements RemoteFs {
  readonly protocol = 'sftp' as const
  private _closed = false

  constructor(
    readonly client: Client,
    private readonly sftp: SFTPWrapper
  ) {
    client.once('close', () => (this._closed = true))
  }

  get closed(): boolean {
    return this._closed
  }

  async list(dir: string): Promise<FsEntry[]> {
    const d = posixNormalize(dir)
    const list = await p<{ filename: string; attrs: Stats }[]>((cb) => this.sftp.readdir(d, cb as never), d)
    const out = await Promise.all(
      list
        .filter((e) => e.filename !== '.' && e.filename !== '..')
        .map(async (e): Promise<FsEntry> => {
          const path = posixJoin(d, e.filename)
          let type = entryType(e.attrs)
          let size = e.attrs.size
          if (type === 'symlink') {
            try {
              const t = await p<Stats>((cb) => this.sftp.stat(path, cb), path)
              type = t.isDirectory() ? 'dir' : 'file'
              size = t.size
            } catch {
              /* dangling link: keep as symlink */
            }
          }
          return { name: e.filename, path, type, size, mtime: e.attrs.mtime * 1000, mode: e.attrs.mode & 0o7777 }
        })
    )
    return out
  }

  async stat(path: string): Promise<FsEntry> {
    const n = posixNormalize(path)
    const a = await p<Stats>((cb) => this.sftp.stat(n, cb), n)
    return { name: basename(n) || '/', path: n, type: entryType(a), size: a.size, mtime: a.mtime * 1000, mode: a.mode & 0o7777 }
  }

  private async exists(path: string): Promise<FsEntry | null> {
    try {
      return await this.stat(path)
    } catch (e) {
      if (e instanceof RemoteFsError && e.code === 'ENOENT') return null
      throw e
    }
  }

  async mkdir(path: string, recursive = false): Promise<void> {
    const n = posixNormalize(path)
    if (!recursive) {
      await p<void>((cb) => this.sftp.mkdir(n, cb as never), n)
      return
    }
    const st = await this.exists(n)
    if (st) {
      if (st.type !== 'dir') throw new RemoteFsError('ENOTDIR', `${n} is not a directory`)
      return
    }
    const parent = posixDirname(n)
    if (parent !== n) await this.mkdir(parent, true)
    try {
      await p<void>((cb) => this.sftp.mkdir(n, cb as never), n)
    } catch (e) {
      // Raced with another job creating the same directory.
      if (!(await this.exists(n))) throw e
    }
  }

  async rename(from: string, to: string): Promise<void> {
    await p<void>((cb) => this.sftp.rename(from, to, cb as never), from)
  }

  async deleteFile(path: string): Promise<void> {
    await p<void>((cb) => this.sftp.unlink(path, cb as never), path)
  }

  async deleteDir(path: string): Promise<void> {
    await p<void>((cb) => this.sftp.rmdir(path, cb as never), path)
  }

  async readFile(path: string, maxBytes = Infinity): Promise<Buffer> {
    const st = await this.stat(path)
    if (st.size > maxBytes) throw new RemoteFsError('ETOOBIG', `${basename(path)} is larger than ${Math.round(maxBytes / 1e6)} MB`)
    const chunks: Buffer[] = []
    const rs = this.sftp.createReadStream(path)
    try {
      for await (const c of rs) chunks.push(c as Buffer)
    } catch (e) {
      throw toRemoteFsError(e, path)
    }
    return Buffer.concat(chunks)
  }

  async writeFile(path: string, data: Buffer, mode?: number): Promise<void> {
    const ws = this.sftp.createWriteStream(path, mode != null ? { mode } : undefined)
    await new Promise<void>((resolve, reject) => {
      ws.on('error', (e: Error) => reject(toRemoteFsError(e, path)))
      ws.on('close', () => resolve())
      ws.end(data)
    })
  }

  async download(remote: string, localPath: string, ctl: TransferControl): Promise<void> {
    const start = ctl.startAt ?? 0
    try {
      await pipeline(
        this.sftp.createReadStream(remote, { start }),
        counter(start, ctl.onProgress),
        createWriteStream(localPath, { flags: start ? 'a' : 'w' }),
        { signal: ctl.signal }
      )
    } catch (e) {
      throw toRemoteFsError(e, remote)
    }
  }

  async upload(localPath: string, remote: string, ctl: TransferControl): Promise<void> {
    const start = ctl.startAt ?? 0
    try {
      await pipeline(
        createReadStream(localPath, { start }),
        counter(start, ctl.onProgress),
        this.sftp.createWriteStream(remote, { flags: start ? 'r+' : 'w', start, ...(ctl.mode != null ? { mode: ctl.mode } : {}) }),
        { signal: ctl.signal }
      )
    } catch (e) {
      throw toRemoteFsError(e, remote)
    }
    if (ctl.mode != null) {
      try {
        await this.chmod(remote, ctl.mode)
      } catch {
        /* best effort */
      }
    }
  }

  async chmod(path: string, mode: number): Promise<void> {
    await p<void>((cb) => this.sftp.chmod(path, mode, cb as never), path)
  }

  async realpath(path: string): Promise<string> {
    return p<string>((cb) => this.sftp.realpath(path, cb), path)
  }

  async ping(): Promise<number> {
    const t = performance.now()
    await this.realpath('.')
    return Math.round(performance.now() - t)
  }

  async close(): Promise<void> {
    if (this._closed) return
    this._closed = true
    try {
      this.sftp.end()
    } catch {
      /* ignore */
    }
    this.client.end()
  }
}
