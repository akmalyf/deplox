export type RemoteErrorCode =
  | 'ENOENT'
  | 'EACCES'
  | 'EEXIST'
  | 'ENOTEMPTY'
  | 'ENOTDIR'
  | 'ECONN'
  | 'EAUTH'
  | 'EHOSTKEY'
  | 'ENOTSUP'
  | 'EABORT'
  | 'ESTALE'
  | 'EBINARY'
  | 'ETOOBIG'
  | 'ENOMAP'
  | 'EUNKNOWN'

/** Error whose message carries the code as `[CODE] message` so it survives IPC serialization. */
export class RemoteFsError extends Error {
  constructor(
    readonly code: RemoteErrorCode,
    readonly detail: string
  ) {
    super(`[${code}] ${detail}`)
    this.name = 'RemoteFsError'
  }
}

const NET_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'ERR_STREAM_PREMATURE_CLOSE'])

export function toRemoteFsError(err: unknown, context = ''): RemoteFsError {
  if (err instanceof RemoteFsError) return err
  const e = err as { code?: unknown; message?: string; name?: string; level?: string }
  const msg = (e?.message ?? String(err)).replace(/^\[[A-Z]+\]\s*/, '')
  const where = context ? `${context}: ` : ''
  if (e?.name === 'AbortError' || e?.code === 'ABORT_ERR') return new RemoteFsError('EABORT', 'Canceled')
  if (e?.level === 'client-authentication') return new RemoteFsError('EAUTH', 'Authentication failed')
  if (e?.level === 'client-timeout') return new RemoteFsError('ECONN', 'Connection timed out')
  if (e?.level === 'client-socket') return new RemoteFsError('ECONN', msg)
  if (typeof e?.code === 'string') {
    if (NET_CODES.has(e.code)) return new RemoteFsError('ECONN', `${where}${msg}`)
    if (['ENOENT', 'EACCES', 'EEXIST', 'ENOTEMPTY', 'ENOTDIR'].includes(e.code)) return new RemoteFsError(e.code as RemoteErrorCode, `${where}${msg}`)
    if (e.code === 'EPERM') return new RemoteFsError('EACCES', `${where}${msg}`)
  }
  if (typeof e?.code === 'number') {
    // SFTP status codes
    if (e.code === 2) return new RemoteFsError('ENOENT', `${where}No such file`)
    if (e.code === 3) return new RemoteFsError('EACCES', `${where}Permission denied`)
    if (e.code === 8) return new RemoteFsError('ENOTSUP', `${where}Operation unsupported`)
    if (e.code === 7) return new RemoteFsError('ECONN', `${where}Connection lost`)
    // FTP reply codes
    if (e.code === 530) return new RemoteFsError('EAUTH', msg)
    if (e.code === 550) return new RemoteFsError(/exist/i.test(msg) ? 'EEXIST' : /permission|denied/i.test(msg) ? 'EACCES' : 'ENOENT', `${where}${msg}`)
    if (e.code === 421 || e.code === 425 || e.code === 426) return new RemoteFsError('ECONN', `${where}${msg}`)
    if (e.code === 500 || e.code === 502 || e.code === 504) return new RemoteFsError('ENOTSUP', `${where}${msg}`)
  }
  if (/client is closed|socket closed|not connected|no response|timeout/i.test(msg)) return new RemoteFsError('ECONN', `${where}${msg}`)
  if (/no such file|not found/i.test(msg)) return new RemoteFsError('ENOENT', `${where}${msg}`)
  if (/permission denied/i.test(msg)) return new RemoteFsError('EACCES', `${where}${msg}`)
  return new RemoteFsError('EUNKNOWN', `${where}${msg}`)
}
