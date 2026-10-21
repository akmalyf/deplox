import type { SessionInfo } from '@shared/types'

export interface TerminalSession {
  readonly id: string
  readonly kind: 'ssh' | 'local'
  write(data: string): void
  resize(cols: number, rows: number): void
  pause(): void
  resume(): void
  close(): void
  onData(cb: (chunk: Uint8Array) => void): void
  onExit(cb: (code: number | null, reason?: string) => void): void
  info(): SessionInfo
}
