import { createReadStream, createWriteStream } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { TLSSocket } from 'node:tls'
// basic-ftp is CommonJS: use the default export from ESM.
import ftp from 'basic-ftp'
import type { Client as FtpClient, FileInfo } from 'basic-ftp'
import type { FsEntry } from '@shared/types'
import { basename, posixDirname, posixJoin, posixNormalize } from '@shared/paths'
import type { RemoteFs, TransferControl } from './RemoteFs'
import { RemoteFsError, toRemoteFsError } from './errors'
import { counter } from './SftpFs'

export interface FtpOptions {
  host: string
  port: number
  user: string
  password: string
  secure: false | true | 'implicit'
}

const { Client, FileType } = ftp
type Client = FtpClient

function modeOf(f: FileInfo): number | undefined {
  const p = f.permissions
  return p ? (p.user << 6) | (p.group << 3) | p.world : undefined
}

function mtimeOf(f: FileInfo): number {
  if (f.modifiedAt) return f.modifiedAt.getTime()
  const t = Date.parse(f.rawModifiedAt)
  return Number.isNaN(t) ? 0 : t
}

/**
 * basic-ftp Client wrapper. One command at a time per control connection, so every
 * operation is serialized through `run()`.
 */
export class FtpFs implements RemoteFs {
  readonly protocol: 'ftp' | 'ftps'
  private chain: Promise<unknown> = Promise.resolve()
  private listCache = new Map<string, { at: number; entries: FsEntry[] }>()
  welcome = ''

  private constructor(
    private readonly client: Client,
    secure: boolean
  ) {
    this.protocol = secure ? 'ftps' : 'ftp'
  }

  static async connect(opts: FtpOptions): Promise<FtpFs> {
    const client = new Client(20_000)
    try {
      const res = await client.access({
        host: opts.host,
        port: opts.port,
        user: opts.user,
        password: opts.password,
        secure: opts.secure,
        // Self-signed certificates are common on shared hosting.
        secureOptions: { rejectUnauthorized: false }
      })
      const fs = new FtpFs(client, !!opts.secure)
      fs.welcome = res.message.split('\n')[0].replace(/^\d{3}[- ]/, '').trim()
      return fs
    } catch (e) {
      client.close()
      throw toRemoteFsError(e)
    }
  }

  get closed(): boolean {
    return this.client.closed
  }

  get cipher(): string | undefined {
    const s = this.client.ftp.socket
    return s instanceof TLSSocket ? s.getCipher()?.name : undefined
  }

  private run<T>(fn: () => Promise<T>, ctx = ''): Promise<T> {
    const next = this.chain.then(fn, fn).catch((e) => {
      throw toRemoteFsError(e, ctx)
    })
    this.chain = next.catch(() => undefined)
    return next
  }

  private invalidate(path: string): void {
    this.listCache.delete(posixDirname(posixNormalize(path)))
    this.listCache.delete(posixNormalize(path))
  }

  async list(dir: string): Promise<FsEntry[]> {
    const d = posixNormalize(dir)
    const entries = await this.run(async () => {
      const raw = await this.client.list(d)
      return raw
        .filter((f) => f.name !== '.' && f.name !== '..')
        .map(
          (f): FsEntry => ({
            name: f.name,
            path: posixJoin(d, f.name),
            type: f.type === FileType.Directory ? 'dir' : f.type === FileType.SymbolicLink ? 'symlink' : 'file',
            size: f.size,
            mtime: mtimeOf(f),
            mode: modeOf(f)
          })
        )
    }, d)
    this.listCache.set(d, { at: Date.now(), entries })
    return entries
  }

  async stat(path: string): Promise<FsEntry> {
    const n = posixNormalize(path)
    if (n === '/') return { name: '/', path: '/', type: 'dir', size: 0, mtime: 0 }
    const parent = posixDirname(n)
    const cached = this.listCache.get(parent)
    const entries = cached && Date.now() - cached.at < 2000 ? cached.entries : await this.list(parent)
    const hit = entries.find((e) => e.name === basename(n))
    if (!hit) throw new RemoteFsError('ENOENT', `${n}: No such file`)
    return hit
  }

  async mkdir(path: string, recursive = false): Promise<void> {
    const n = posixNormalize(path)
    if (!recursive) {
      await this.run(() => this.client.send('MKD ' + n), n)
      this.invalidate(n)
      return
    }
    const segs = n.split('/').filter(Boolean)
    let cur = n.startsWith('/') ? '' : '.'
    for (const s of segs) {
      cur = cur + '/' + s
      const at = cur
      await this.run(() => this.client.sendIgnoringError('MKD ' + at), at)
    }
    this.invalidate(n)
    const st = await this.stat(n)
    if (st.type !== 'dir') throw new RemoteFsError('ENOTDIR', `${n} is not a directory`)
  }

  async rename(from: string, to: string): Promise<void> {
    await this.run(() => this.client.rename(from, to), from)
    this.invalidate(from)
    this.invalidate(to)
  }

  async deleteFile(path: string): Promise<void> {
    await this.run(() => this.client.remove(path), path)
    this.invalidate(path)
  }

  async deleteDir(path: string): Promise<void> {
    await this.run(() => this.client.removeEmptyDir(path), path)
    this.invalidate(path)
  }

  async readFile(path: string, maxBytes = Infinity): Promise<Buffer> {
    const st = await this.stat(path)
    if (st.size > maxBytes) throw new RemoteFsError('ETOOBIG', `${basename(path)} is larger than ${Math.round(maxBytes / 1e6)} MB`)
    const chunks: Buffer[] = []
    const sink = new Writable({
      write(chunk: Buffer, _e, cb) {
        chunks.push(chunk)
        cb()
      }
    })
    await this.run(() => this.client.downloadTo(sink, path), path)
    return Buffer.concat(chunks)
  }

  async writeFile(path: string, data: Buffer, mode?: number): Promise<void> {
    await this.run(() => this.client.uploadFrom(Readable.from([data]), path), path)
    this.invalidate(path)
    if (mode != null) await this.chmod(path, mode).catch(() => undefined)
  }

  /** basic-ftp has no per-transfer cancel: aborting closes this control connection. */
  private bindAbort(signal: AbortSignal, destroy: () => void): () => void {
    const onAbort = () => {
      destroy()
      this.client.close()
    }
    if (signal.aborted) onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    return () => signal.removeEventListener('abort', onAbort)
  }

  async download(remote: string, localPath: string, ctl: TransferControl): Promise<void> {
    const start = ctl.startAt ?? 0
    const ws = createWriteStream(localPath, { flags: start ? 'a' : 'w' })
    const c = counter(start, ctl.onProgress)
    c.pipe(ws)
    const unbind = this.bindAbort(ctl.signal, () => c.destroy())
    try {
      await this.run(() => this.client.downloadTo(c, remote, start), remote)
      c.end()
      await finished(ws)
    } catch (e) {
      ws.destroy()
      throw ctl.signal.aborted ? new RemoteFsError('EABORT', 'Canceled') : toRemoteFsError(e, remote)
    } finally {
      unbind()
    }
  }

  async upload(localPath: string, remote: string, ctl: TransferControl): Promise<void> {
    const start = ctl.startAt ?? 0
    const src = createReadStream(localPath, { start }).pipe(counter(start, ctl.onProgress))
    const unbind = this.bindAbort(ctl.signal, () => src.destroy())
    try {
      await this.run(() => (start ? this.client.appendFrom(src, remote) : this.client.uploadFrom(src, remote)), remote)
    } catch (e) {
      throw ctl.signal.aborted ? new RemoteFsError('EABORT', 'Canceled') : toRemoteFsError(e, remote)
    } finally {
      unbind()
    }
    this.invalidate(remote)
    if (ctl.mode != null) await this.chmod(remote, ctl.mode).catch(() => undefined)
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.run(() => this.client.send(`SITE CHMOD ${(mode & 0o777).toString(8)} ${path}`), path)
  }

  async realpath(path: string): Promise<string> {
    if (path === '.' || path === '') return this.run(() => this.client.pwd())
    return posixNormalize(path)
  }

  async ping(): Promise<number> {
    const t = performance.now()
    await this.run(() => this.client.send('NOOP'))
    return Math.round(performance.now() - t)
  }

  async close(): Promise<void> {
    this.client.close()
  }
}
