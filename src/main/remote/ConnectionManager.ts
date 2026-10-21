import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
// ssh2 is CommonJS: Node's ESM loader can't see its named exports.
import ssh2 from 'ssh2'
import type { Client as SshClient, ConnectConfig, SFTPWrapper } from 'ssh2'
import type { ConnInfo, HostConn, PromptAnswer } from '@shared/types'
import { expandHome } from '@shared/paths'
import type { StoredHost } from '../store/schema'
import type { Secrets } from '../store/secrets'
import { secretRef, type SecretKind } from '../store/secrets'
import type { KnownHosts } from '../store/knownHosts'
import type { Prompter } from './Prompter'
import type { RemoteFs } from './RemoteFs'
import { SftpFs } from './SftpFs'
import { FtpFs } from './FtpFs'
import { RemoteFsError, toRemoteFsError } from './errors'

const { Client, utils: sshUtils } = ssh2
type Client = SshClient
import { displayKeyType, fingerprint, keyType } from './hostKey'

const BACKOFF_S = [2, 5, 10, 20, 30]
const PING_MS = 10_000
const POOL_IDLE_MS = 60_000

interface FtpSlot {
  fs: FtpFs
  busy: boolean
  idleTimer?: NodeJS.Timeout
}

interface Conn {
  state: HostConn
  sftp?: SftpFs
  ftp?: FtpFs
  pool: FtpSlot[]
  waiters: ((slot: FtpSlot) => void)[]
  connecting?: Promise<void>
  retryTimer?: NodeJS.Timeout
  pingTimer?: NodeJS.Timeout
  manual: boolean
  /** Bumped on every (re)connect so stale close events are ignored. */
  gen: number
}

export interface ConnectionDeps {
  getHost(id: string): StoredHost | undefined
  secrets: Secrets
  knownHosts: KnownHosts
  prompter: Prompter
}

interface ConnectOpts {
  interactive: boolean
  /** Ask for the password even when one is stored (after an auth failure). */
  forcePrompt?: boolean
}

export interface OpenedSsh {
  client: Client
  sftp: SFTPWrapper
  info: ConnInfo
}

/**
 * Owns one live connection per host (SFTP: one ssh2 Client + SFTP channel;
 * FTP: one browsing connection + a pool for transfers), keeps it alive and
 * reconnects with backoff when it drops.
 *
 * Events: 'state' (HostConn), 'connected' (hostId), 'lost' (hostId).
 */
export class ConnectionManager extends EventEmitter {
  private readonly conns = new Map<string, Conn>()

  constructor(private readonly deps: ConnectionDeps) {
    super()
  }

  /* ---------------- state ---------------- */

  private conn(hostId: string): Conn {
    let c = this.conns.get(hostId)
    if (!c) {
      c = { state: { hostId, state: 'disconnected', attempt: 0, maxAttempts: BACKOFF_S.length, info: {} }, pool: [], waiters: [], manual: false, gen: 0 }
      this.conns.set(hostId, c)
    }
    return c
  }

  state(hostId: string): HostConn {
    return this.conn(hostId).state
  }

  allStates(): HostConn[] {
    return [...this.conns.values()].map((c) => c.state)
  }

  isConnected(hostId: string): boolean {
    return this.conns.get(hostId)?.state.state === 'connected'
  }

  private setState(c: Conn, patch: Partial<HostConn>): void {
    c.state = { ...c.state, ...patch, info: { ...c.state.info, ...(patch.info ?? {}) } }
    if (patch.state && patch.state !== 'reconnecting') c.state.nextRetryAt = patch.nextRetryAt
    if (patch.state === 'connected') c.state.error = undefined
    this.emit('state', c.state)
  }

  /* ---------------- public API ---------------- */

  /** Remote file system for browsing; connects (interactively) on demand. */
  async get(hostId: string): Promise<RemoteFs> {
    const c = this.conn(hostId)
    if (c.state.state !== 'connected') await this.connect(hostId, { interactive: true })
    const fs = c.sftp ?? c.ftp
    if (!fs || fs.closed) {
      this.onLost(hostId, c.gen, 'Connection closed')
      throw new RemoteFsError('ECONN', 'Not connected')
    }
    return this.guard(hostId, fs)
  }

  /** A connection for one transfer. SFTP shares the channel; FTP borrows a pool slot. */
  async acquire(hostId: string, maxSlots: number): Promise<{ fs: RemoteFs; release: () => void }> {
    const c = this.conn(hostId)
    if (c.state.state !== 'connected') await this.connect(hostId, { interactive: false })
    if (c.sftp) return { fs: this.guard(hostId, c.sftp), release: () => undefined }
    const host = this.requireHost(hostId)

    let slot = c.pool.find((s) => !s.busy && !s.fs.closed)
    if (!slot) {
      c.pool = c.pool.filter((s) => !s.fs.closed)
      if (c.pool.length < Math.max(1, maxSlots)) {
        const fs = await this.openFtp(host, { interactive: false })
        slot = { fs, busy: false }
        c.pool.push(slot)
      } else {
        slot = await new Promise<FtpSlot>((resolve) => c.waiters.push(resolve))
      }
    }
    const s = slot
    s.busy = true
    if (s.idleTimer) clearTimeout(s.idleTimer)
    return {
      fs: s.fs,
      release: () => {
        s.busy = false
        if (s.fs.closed) {
          c.pool = c.pool.filter((x) => x !== s)
          return
        }
        const w = c.waiters.shift()
        if (w) {
          s.busy = true
          w(s)
          return
        }
        s.idleTimer = setTimeout(() => {
          if (!s.busy) {
            c.pool = c.pool.filter((x) => x !== s)
            void s.fs.close()
          }
        }, POOL_IDLE_MS)
      }
    }
  }

  /** ssh2 Client for shells. Only for SFTP hosts. */
  async sshClient(hostId: string): Promise<Client> {
    const host = this.requireHost(hostId)
    if (host.protocol !== 'sftp') throw new RemoteFsError('ENOTSUP', `${host.name} uses ${host.protocol.toUpperCase()}: SSH terminal needs an SFTP host`)
    await this.get(hostId)
    const c = this.conn(hostId)
    if (!c.sftp) throw new RemoteFsError('ECONN', 'Not connected')
    return c.sftp.client
  }

  connect(hostId: string, opts: ConnectOpts = { interactive: true }): Promise<void> {
    const c = this.conn(hostId)
    if (c.state.state === 'connected') return Promise.resolve()
    if (c.connecting) return c.connecting
    if (c.retryTimer) {
      clearTimeout(c.retryTimer)
      c.retryTimer = undefined
    }
    c.manual = false
    const forcePrompt = opts.forcePrompt ?? c.state.state === 'auth-failed'
    c.connecting = this.doConnect(hostId, { ...opts, forcePrompt }).finally(() => {
      c.connecting = undefined
    })
    return c.connecting
  }

  async disconnect(hostId: string): Promise<void> {
    const c = this.conn(hostId)
    c.manual = true
    c.gen++
    this.teardown(c)
    this.setState(c, { state: 'disconnected', attempt: 0, nextRetryAt: undefined, error: undefined })
  }

  async disconnectAll(): Promise<void> {
    for (const id of this.conns.keys()) await this.disconnect(id)
  }

  /** Open a throwaway connection to validate settings. */
  async test(host: StoredHost, secret: string | null): Promise<{ serverVersion?: string; latencyMs: number }> {
    if (host.protocol === 'sftp') {
      const { client, sftp, info } = await this.openSsh(host, { interactive: true }, secret ?? undefined)
      const fs = new SftpFs(client, sftp)
      try {
        const latencyMs = await fs.ping()
        return { serverVersion: info.serverVersion, latencyMs }
      } finally {
        await fs.close()
      }
    }
    const fs = await this.openFtp(host, { interactive: true }, secret ?? undefined)
    try {
      const latencyMs = await fs.ping()
      return { serverVersion: fs.welcome, latencyMs }
    } finally {
      await fs.close()
    }
  }

  forget(hostId: string): void {
    const c = this.conns.get(hostId)
    if (!c) return
    c.gen++
    this.teardown(c)
    this.conns.delete(hostId)
  }

  /* ---------------- internals ---------------- */

  private requireHost(hostId: string): StoredHost {
    const h = this.deps.getHost(hostId)
    if (!h) throw new RemoteFsError('ENOENT', 'Host not found')
    return h
  }

  private async doConnect(hostId: string, opts: ConnectOpts): Promise<void> {
    const c = this.conn(hostId)
    const host = this.requireHost(hostId)
    const reconnecting = c.state.state === 'reconnecting'
    const gen = ++c.gen
    this.teardown(c)
    if (!reconnecting) this.setState(c, { state: 'connecting', attempt: 0, error: undefined })
    try {
      if (host.protocol === 'sftp') {
        const { client, sftp, info } = await this.openSsh(host, opts, undefined, c)
        if (gen !== c.gen) {
          client.end()
          return
        }
        c.sftp = new SftpFs(client, sftp)
        client.on('close', () => this.onLost(hostId, gen, 'Connection closed'))
        client.on('error', (e) => this.onLost(hostId, gen, e.message))
        this.setState(c, { state: 'connected', attempt: 0, connectedAt: Date.now(), info })
      } else {
        const fs = await this.openFtp(host, opts)
        if (gen !== c.gen) {
          void fs.close()
          return
        }
        c.ftp = fs
        this.setState(c, { state: 'connected', attempt: 0, connectedAt: Date.now(), info: { serverVersion: fs.welcome, cipher: fs.cipher } })
      }
      this.startPing(hostId, gen)
      this.emit('connected', hostId)
    } catch (e) {
      const err = toRemoteFsError(e)
      if (gen !== c.gen) throw err
      if (err.code === 'EAUTH') {
        this.setState(c, { state: 'auth-failed', error: authMessage(host, err.detail) })
      } else if (err.code === 'EHOSTKEY' || err.code === 'EABORT') {
        this.setState(c, { state: 'disconnected', error: err.detail })
      } else if (reconnecting) {
        this.scheduleRetry(hostId, gen, err.detail)
      } else {
        this.setState(c, { state: 'error', error: err.detail })
      }
      throw err
    }
  }

  private teardown(c: Conn): void {
    if (c.pingTimer) clearInterval(c.pingTimer)
    if (c.retryTimer) clearTimeout(c.retryTimer)
    c.pingTimer = undefined
    c.retryTimer = undefined
    const fs = c.sftp ?? c.ftp
    c.sftp = undefined
    c.ftp = undefined
    if (fs) void fs.close().catch(() => undefined)
    for (const s of c.pool) {
      if (s.idleTimer) clearTimeout(s.idleTimer)
      void s.fs.close().catch(() => undefined)
    }
    c.pool = []
  }

  private startPing(hostId: string, gen: number): void {
    const c = this.conn(hostId)
    const tick = async () => {
      const fs = c.sftp ?? c.ftp
      if (!fs || gen !== c.gen) return
      try {
        const latencyMs = await fs.ping()
        if (gen === c.gen) this.setState(c, { info: { latencyMs } })
      } catch (e) {
        const err = toRemoteFsError(e)
        if (err.code === 'ECONN') this.onLost(hostId, gen, err.detail)
      }
    }
    void tick()
    c.pingTimer = setInterval(tick, PING_MS)
  }

  private onLost(hostId: string, gen: number, reason: string): void {
    const c = this.conns.get(hostId)
    if (!c || gen !== c.gen || c.manual) return
    if (c.state.state !== 'connected') return
    c.gen++
    this.teardown(c)
    this.emit('lost', hostId)
    this.scheduleRetry(hostId, c.gen, reason, 0)
  }

  private scheduleRetry(hostId: string, gen: number, reason: string, attemptOverride?: number): void {
    const c = this.conn(hostId)
    const attempt = (attemptOverride ?? c.state.attempt) + 1
    if (attempt > BACKOFF_S.length) {
      this.setState(c, { state: 'error', error: `Connection lost: ${reason}`, attempt: attempt - 1, nextRetryAt: undefined })
      return
    }
    const delay = BACKOFF_S[attempt - 1] * 1000
    this.setState(c, { state: 'reconnecting', error: reason, attempt, nextRetryAt: Date.now() + delay })
    c.retryTimer = setTimeout(() => {
      c.retryTimer = undefined
      if (gen !== c.gen) return
      void this.connect(hostId, { interactive: false }).catch(() => undefined)
    }, delay)
  }

  /** Wraps a RemoteFs so connection errors trigger reconnect handling. */
  private guard(hostId: string, fs: RemoteFs): RemoteFs {
    const c = this.conn(hostId)
    const gen = c.gen
    return new Proxy(fs, {
      get: (target, prop, recv) => {
        const v = Reflect.get(target, prop, recv)
        if (typeof v !== 'function') return v
        return (...args: unknown[]) => {
          const r = v.apply(target, args)
          if (r && typeof (r as Promise<unknown>).then === 'function') {
            return (r as Promise<unknown>).catch((e) => {
              const err = toRemoteFsError(e)
              if (err.code === 'ECONN') this.onLost(hostId, gen, err.detail)
              throw err
            })
          }
          return r
        }
      }
    })
  }

  /* ---------------- secrets ---------------- */

  private async resolveSecret(host: StoredHost, kind: SecretKind, opts: ConnectOpts, reason?: string): Promise<string> {
    const ref = secretRef(host.id, kind)
    if (!opts.forcePrompt) {
      const v = this.deps.secrets.get(ref)
      if (v != null) return v
    }
    if (!opts.interactive) throw new RemoteFsError('EAUTH', kind === 'password' ? 'Password required' : 'Key passphrase required')
    const a = (await this.deps.prompter.ask({
      kind: 'password',
      hostId: host.id,
      hostName: host.name,
      secretKind: kind,
      reason,
      canSave: this.deps.secrets.available()
    })) as Extract<PromptAnswer, { kind: 'password' }>
    if (a.value == null) throw new RemoteFsError('EABORT', 'Sign-in canceled')
    this.deps.secrets.set(ref, a.value, a.save)
    return a.value
  }

  /* ---------------- SSH ---------------- */

  async openSsh(host: StoredHost, opts: ConnectOpts, secretOverride?: string, c?: Conn): Promise<OpenedSsh> {
    const cfg: ConnectConfig = {
      host: host.host,
      port: host.port || 22,
      username: host.username,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 3,
      readyTimeout: 20_000
    }
    const method = host.auth.method
    if (method === 'password') {
      cfg.password = secretOverride ?? (await this.resolveSecret(host, 'password', opts, opts.forcePrompt ? 'The server rejected the saved password' : undefined))
    } else if (method === 'key') {
      const keyPath = expandHome(host.auth.keyPath || '~/.ssh/id_ed25519', homedir())
      let key: Buffer
      try {
        key = await readFile(keyPath)
      } catch {
        throw new RemoteFsError('EAUTH', `Can't read private key ${keyPath}`)
      }
      cfg.privateKey = key
      const parsed = sshUtils.parseKey(key)
      if (parsed instanceof Error) {
        if (!/passphrase|encrypted/i.test(parsed.message)) throw new RemoteFsError('EAUTH', `Unsupported key: ${parsed.message}`)
        cfg.passphrase = secretOverride ?? (await this.resolveSecret(host, 'passphrase', opts))
        const check = sshUtils.parseKey(key, cfg.passphrase)
        if (check instanceof Error) {
          this.deps.secrets.deleteStored(secretRef(host.id, 'passphrase'))
          this.deps.secrets.forgetSession(secretRef(host.id, 'passphrase'))
          throw new RemoteFsError('EAUTH', 'Wrong key passphrase')
        }
      }
    } else {
      cfg.agent = process.platform === 'win32' ? 'pageant' : process.env.SSH_AUTH_SOCK
      if (!cfg.agent) throw new RemoteFsError('EAUTH', 'SSH agent is not running (SSH_AUTH_SOCK is not set)')
    }

    const info: ConnInfo = {}
    let hostKeyError: RemoteFsError | null = null
    cfg.hostVerifier = ((key: Buffer, verify: (ok: boolean) => void) => {
      const type = keyType(key)
      const fp = fingerprint(key)
      info.hostKeyType = displayKeyType(type)
      const port = host.port || 22
      const known = this.deps.knownHosts.get(host.host, port)
      if (known && known.fingerprint === fp) return verify(true)
      if (!opts.interactive) {
        hostKeyError = new RemoteFsError('EHOSTKEY', known ? 'Host key changed' : 'Unknown host key')
        return verify(false)
      }
      if (c) this.setState(c, { state: 'verifying' })
      const ask = known
        ? this.deps.prompter.ask({ kind: 'hostkey-mismatch', hostId: host.id, hostName: host.name, host: host.host, port, keyType: displayKeyType(type), expected: known.fingerprint, actual: fp })
        : this.deps.prompter.ask({ kind: 'hostkey', hostId: host.id, hostName: host.name, host: host.host, port, keyType: displayKeyType(type), fingerprint: fp })
      ask
        .then((a) => {
          if (a.kind === 'hostkey' && a.trust) {
            if (a.remember) this.deps.knownHosts.set(host.host, port, { keyType: type, fingerprint: fp, addedAt: Date.now() })
            if (c) this.setState(c, { state: 'authenticating' })
            verify(true)
          } else if (a.kind === 'hostkey-mismatch' && a.forget) {
            // Forget the old key; the caller retries and the user is asked to trust the new one.
            this.deps.knownHosts.delete(host.host, port)
            hostKeyError = new RemoteFsError('EHOSTKEY', 'Stored host key removed, connect again to verify the new key')
            verify(false)
          } else {
            hostKeyError = new RemoteFsError('EHOSTKEY', known ? 'Host key mismatch: connection refused' : 'Host key not trusted')
            verify(false)
          }
        })
        .catch(() => {
          hostKeyError = new RemoteFsError('EHOSTKEY', 'Host key not verified')
          verify(false)
        })
    }) as ConnectConfig['hostVerifier']

    const client = new Client()
    client.on('handshake', (n) => {
      info.cipher = n.cs.cipher
      info.kex = n.kex
    })
    await new Promise<void>((resolve, reject) => {
      const onError = (e: Error) => {
        client.removeListener('ready', onReady)
        reject(hostKeyError ?? toRemoteFsError(e))
      }
      const onReady = () => {
        client.removeListener('error', onError)
        resolve()
      }
      client.once('ready', onReady)
      client.once('error', onError)
      client.connect(cfg)
    })
    info.serverVersion = (client as unknown as { _remoteVer?: string })._remoteVer
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => client.sftp((err, s) => (err ? reject(toRemoteFsError(err)) : resolve(s))))
    return { client, sftp, info }
  }

  /* ---------------- FTP ---------------- */

  private async openFtp(host: StoredHost, opts: ConnectOpts, secretOverride?: string): Promise<FtpFs> {
    const password = secretOverride ?? (await this.resolveSecret(host, 'password', opts, opts.forcePrompt ? 'The server rejected the saved password' : undefined))
    const secure = host.protocol === 'ftps' ? (host.ftp?.implicitTls ? 'implicit' : true) : false
    return FtpFs.connect({ host: host.host, port: host.port || (host.protocol === 'ftps' && host.ftp?.implicitTls ? 990 : 21), user: host.username, password, secure })
  }
}

function authMessage(host: StoredHost, detail: string): string {
  if (host.auth.method === 'password' || host.protocol !== 'sftp') return `The server rejected the password (${detail})`
  return detail
}
