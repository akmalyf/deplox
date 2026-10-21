import { createRequire } from 'node:module'
import { accessSync, chmodSync, constants } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { IPty } from 'node-pty'
import type { SessionInfo } from '@shared/types'
import type { TerminalSession } from './TerminalSession'

const nodeRequire = createRequire(import.meta.url)
const encoder = new TextEncoder()

/** node-pty spawns through a helper binary that must be executable (pnpm may drop +x). */
function ensureSpawnHelper(): void {
  if (process.platform === 'win32') return
  try {
    const root = dirname(nodeRequire.resolve('node-pty/package.json')).replace('app.asar', 'app.asar.unpacked')
    for (const dir of [join(root, 'build/Release'), join(root, 'prebuilds', `${process.platform}-${process.arch}`)]) {
      const helper = join(dir, 'spawn-helper')
      try {
        accessSync(helper, constants.X_OK)
      } catch {
        try {
          chmodSync(helper, 0o755)
        } catch {
          /* not present in this layout */
        }
      }
    }
  } catch {
    /* best effort */
  }
}

let helperChecked = false

export function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC?.toLowerCase().includes('powershell') ? process.env.COMSPEC : 'powershell.exe'
  return process.env.SHELL || '/bin/zsh'
}

export class LocalPtySession implements TerminalSession {
  readonly kind = 'local' as const
  private readonly pty: IPty
  private dataCbs: ((c: Uint8Array) => void)[] = []
  private exitCbs: ((code: number | null, reason?: string) => void)[] = []
  private readonly base: SessionInfo

  constructor(
    readonly id: string,
    opts: { shell: string; cwd: string; cols: number; rows: number }
  ) {
    // node-pty is a native module: load it lazily so a broken build only breaks local terminals.
    if (!helperChecked) {
      helperChecked = true
      ensureSpawnHelper()
    }
    const pty = nodeRequire('node-pty') as typeof import('node-pty')
    const env = { ...process.env, TERM_PROGRAM: 'Deplox', COLORTERM: 'truecolor' } as Record<string, string>
    this.pty = pty.spawn(opts.shell, process.platform === 'win32' ? [] : ['-l'], {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env
    })
    this.base = { kind: 'local', title: basename(opts.shell), cwd: opts.cwd, shell: opts.shell, cols: opts.cols, rows: opts.rows, startedAt: Date.now() }
    this.pty.onData((s) => {
      const u = encoder.encode(s)
      for (const cb of this.dataCbs) cb(u)
    })
    this.pty.onExit(({ exitCode }) => {
      for (const cb of this.exitCbs) cb(exitCode)
    })
  }

  write(data: string): void {
    this.pty.write(data)
  }

  resize(cols: number, rows: number): void {
    this.base.cols = cols
    this.base.rows = rows
    try {
      this.pty.resize(cols, rows)
    } catch {
      /* process already gone */
    }
  }

  pause(): void {
    this.pty.pause()
  }

  resume(): void {
    this.pty.resume()
  }

  close(): void {
    try {
      this.pty.kill()
    } catch {
      /* ignore */
    }
  }

  onData(cb: (chunk: Uint8Array) => void): void {
    this.dataCbs.push(cb)
  }

  onExit(cb: (code: number | null, reason?: string) => void): void {
    this.exitCbs.push(cb)
  }

  info(): SessionInfo {
    return { ...this.base, title: `${basename(this.base.shell ?? 'shell')} · ${this.pty.process}` }
  }
}
