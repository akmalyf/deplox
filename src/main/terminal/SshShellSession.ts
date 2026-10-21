import type { Client, ClientChannel } from 'ssh2'
import type { SessionInfo } from '@shared/types'
import type { TerminalSession } from './TerminalSession'

export class SshShellSession implements TerminalSession {
  readonly kind = 'ssh' as const
  private dataCbs: ((c: Uint8Array) => void)[] = []
  private exitCbs: ((code: number | null, reason?: string) => void)[] = []
  private exited = false

  private constructor(
    readonly id: string,
    private readonly stream: ClientChannel,
    private readonly base: SessionInfo
  ) {
    const onChunk = (c: Buffer) => {
      const u = new Uint8Array(c.buffer, c.byteOffset, c.byteLength)
      for (const cb of this.dataCbs) cb(u)
    }
    stream.on('data', onChunk)
    stream.stderr.on('data', onChunk)
    let code: number | null = null
    stream.on('exit', (c: number | null) => (code = c))
    stream.on('close', () => this.finish(code))
  }

  static open(id: string, client: Client, cols: number, rows: number, base: SessionInfo): Promise<SshShellSession> {
    return new Promise((resolve, reject) => {
      client.shell({ term: 'xterm-256color', cols, rows }, { env: { LANG: process.env.LANG ?? 'en_US.UTF-8' } }, (err, stream) => {
        if (err) reject(err)
        else resolve(new SshShellSession(id, stream, base))
      })
    })
  }

  private finish(code: number | null, reason?: string): void {
    if (this.exited) return
    this.exited = true
    for (const cb of this.exitCbs) cb(code, reason)
  }

  write(data: string): void {
    if (!this.exited) this.stream.write(data)
  }

  resize(cols: number, rows: number): void {
    this.base.cols = cols
    this.base.rows = rows
    if (!this.exited) this.stream.setWindow(rows, cols, 0, 0)
  }

  pause(): void {
    this.stream.pause()
  }

  resume(): void {
    this.stream.resume()
  }

  close(): void {
    try {
      this.stream.end()
      this.stream.close()
    } catch {
      /* ignore */
    }
    this.finish(null, 'closed')
  }

  onData(cb: (chunk: Uint8Array) => void): void {
    this.dataCbs.push(cb)
  }

  onExit(cb: (code: number | null, reason?: string) => void): void {
    this.exitCbs.push(cb)
  }

  /** Called when the underlying connection drops. */
  connectionLost(): void {
    this.finish(null, 'Connection lost')
  }

  info(): SessionInfo {
    return { ...this.base }
  }

  update(patch: Partial<SessionInfo>): void {
    Object.assign(this.base, patch)
  }
}
