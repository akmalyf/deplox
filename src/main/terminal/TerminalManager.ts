import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import type { SessionInfo, TerminalOpenRequest } from '@shared/types'
import { id } from '@shared/ids'
import { expandHome } from '@shared/paths'
import type { ConnectionManager } from '../remote/ConnectionManager'
import type { StoredHost } from '../store/schema'
import { emit } from '../events'
import type { TerminalSession } from './TerminalSession'
import { SshShellSession } from './SshShellSession'
import { LocalPtySession, defaultShell } from './LocalPtySession'

const HIGH_WATER = 1024 * 1024
const LOW_WATER = 256 * 1024

interface Entry {
  session: TerminalSession
  unacked: number
  paused: boolean
}

export class TerminalManager {
  private readonly sessions = new Map<string, Entry>()

  constructor(
    private readonly conns: ConnectionManager,
    private readonly deps: { getHost(id: string): StoredHost | undefined; shell(): string | undefined; defaultCwd(): string | undefined }
  ) {
    conns.on('lost', (hostId: string) => {
      for (const e of this.sessions.values()) {
        if (e.session instanceof SshShellSession && e.session.info().hostId === hostId) e.session.connectionLost()
      }
    })
    conns.on('state', (s: { hostId: string; info: { latencyMs?: number } }) => {
      for (const [sid, e] of this.sessions) {
        if (e.session instanceof SshShellSession && e.session.info().hostId === s.hostId && s.info.latencyMs != null) {
          e.session.update({ latencyMs: s.info.latencyMs })
          emit('terminal:info', { sessionId: sid, info: e.session.info() })
        }
      }
    })
  }

  list(): { id: string; info: SessionInfo }[] {
    return [...this.sessions.entries()].map(([sid, e]) => ({ id: sid, info: e.session.info() }))
  }

  async open(req: TerminalOpenRequest): Promise<{ sessionId: string; info: SessionInfo }> {
    const sid = id('term')
    let session: TerminalSession
    if (req.kind === 'ssh') {
      const host = this.deps.getHost(req.hostId)
      if (!host) throw new Error('[ENOENT] Host not found')
      const client = await this.conns.sshClient(req.hostId)
      const st = this.conns.state(req.hostId)
      const auth = host.auth.method === 'key' ? (host.auth.keyPath?.split('/').pop() ?? 'key') : host.auth.method === 'agent' ? 'ssh-agent' : 'password'
      session = await SshShellSession.open(sid, client, req.cols, req.rows, {
        kind: 'ssh',
        title: `${host.username}@${host.name}`,
        hostId: host.id,
        host: host.host,
        port: host.port,
        user: host.username,
        auth,
        cipher: st.info.cipher,
        latencyMs: st.info.latencyMs,
        cols: req.cols,
        rows: req.rows,
        startedAt: Date.now()
      })
    } else {
      const wanted = req.cwd ? expandHome(req.cwd, homedir()) : this.deps.defaultCwd()
      const cwd = wanted && existsSync(wanted) ? wanted : homedir()
      session = new LocalPtySession(sid, { shell: this.deps.shell() || defaultShell(), cwd, cols: req.cols, rows: req.rows })
    }

    const entry: Entry = { session, unacked: 0, paused: false }
    this.sessions.set(sid, entry)
    session.onData((chunk) => {
      entry.unacked += chunk.byteLength
      emit('terminal:data', { sessionId: sid, chunk })
      if (!entry.paused && entry.unacked > HIGH_WATER) {
        entry.paused = true
        session.pause()
      }
    })
    session.onExit((code, reason) => {
      this.sessions.delete(sid)
      emit('terminal:exit', { sessionId: sid, code, reason })
    })
    return { sessionId: sid, info: session.info() }
  }

  write(sid: string, data: string): void {
    this.sessions.get(sid)?.session.write(data)
  }

  resize(sid: string, cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.sessions.get(sid)?.session.resize(cols, rows)
  }

  ack(sid: string, bytes: number): void {
    const e = this.sessions.get(sid)
    if (!e) return
    e.unacked = Math.max(0, e.unacked - bytes)
    if (e.paused && e.unacked < LOW_WATER) {
      e.paused = false
      e.session.resume()
    }
  }

  close(sid: string): void {
    const e = this.sessions.get(sid)
    if (!e) return
    e.session.close()
    this.sessions.delete(sid)
  }

  closeAll(): void {
    for (const sid of [...this.sessions.keys()]) this.close(sid)
  }
}
