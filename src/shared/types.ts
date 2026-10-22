// Domain types shared by main, preload and renderer. Pure TS, no runtime imports.

export type Protocol = 'sftp' | 'ftp' | 'ftps'
export type AuthMethod = 'key' | 'password' | 'agent'
export type ThemePref = 'dark' | 'light' | 'system'

export interface Mapping {
  /** Absolute local path (may start with ~). */
  local: string
  /** Absolute remote POSIX path. */
  remote: string
}

export interface HostBehavior {
  uploadOnSave: boolean
  compareBeforeOverwrite: boolean
  preservePermissions: boolean
}

export interface Host {
  id: string
  projectId: string
  name: string
  protocol: Protocol
  host: string
  port: number
  username: string
  auth: {
    method: AuthMethod
    keyPath?: string
    /** True when a password/passphrase is stored in the OS keychain (main only knows the value). */
    hasSecret?: boolean
  }
  ftp?: { mode: 'passive' | 'active'; implicitTls: boolean }
  mappings: Mapping[]
  excluded: string[]
  behavior: HostBehavior
  concurrency?: number
  lastConnectedAt?: number
}

export interface Project {
  id: string
  name: string
  color: string
  localRoot: string
  createdAt: number
  lastOpenedAt?: number
}

export interface Snippet {
  id: string
  label: string
  command: string
}

export interface Settings {
  theme: ThemePref
  reduceTransparency: boolean
  defaultConcurrency: number
  shell?: string
  activeProjectId?: string
  activeHostId?: string
}

/* ---------- File system ---------- */

export type EntryType = 'file' | 'dir' | 'symlink'

export interface FsEntry {
  name: string
  /** Absolute path: local native path or remote POSIX path. */
  path: string
  type: EntryType
  size: number
  mtime: number
  mode?: number
}

/* ---------- Connection ---------- */

export type ConnState =
  | 'disconnected'
  | 'connecting'
  | 'verifying'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'auth-failed'
  | 'error'

export interface ConnInfo {
  serverVersion?: string
  cipher?: string
  kex?: string
  hostKeyType?: string
  latencyMs?: number
}

export interface HostConn {
  hostId: string
  state: ConnState
  error?: string
  attempt: number
  maxAttempts: number
  nextRetryAt?: number
  connectedAt?: number
  info: ConnInfo
}

/* ---------- Prompts (main asks, renderer answers) ---------- */

export type PromptPayload =
  | { kind: 'hostkey'; hostId: string; hostName: string; host: string; port: number; keyType: string; fingerprint: string }
  | { kind: 'hostkey-mismatch'; hostId: string; hostName: string; host: string; port: number; keyType: string; expected: string; actual: string }
  | { kind: 'password'; hostId: string; hostName: string; secretKind: 'password' | 'passphrase'; reason?: string; canSave: boolean }
  | { kind: 'overwrite'; hostId: string; hostName: string; localPath: string; remotePath: string; reason: string }

export type PromptAnswer =
  | { kind: 'hostkey'; trust: boolean; remember: boolean }
  | { kind: 'hostkey-mismatch'; forget: boolean }
  | { kind: 'password'; value: string | null; save: boolean }
  | { kind: 'overwrite'; choice: 'overwrite' | 'compare' | 'cancel' }

export interface PromptRequest {
  requestId: string
  payload: PromptPayload
}

/* ---------- Transfers ---------- */

export type TransferKind = 'upload' | 'download' | 'delete-remote' | 'delete-local' | 'mkdir-remote' | 'mkdir-local'
export type TransferState = 'queued' | 'active' | 'paused' | 'done' | 'failed' | 'canceled'
export type TransferSource = 'manual' | 'sync' | 'save'

export interface TransferJob {
  id: string
  groupId?: string
  /** Jobs in a group run phase by phase (mkdirs, then files; deletes: files, then deepest dirs). */
  phase?: number
  kind: TransferKind
  hostId: string
  localPath: string
  remotePath: string
  size: number
  bytes: number
  state: TransferState
  error?: string
  attempt: number
  speedBps: number
  source: TransferSource
  createdAt: number
  startedAt?: number
  finishedAt?: number
}

export interface TransferGroup {
  id: string
  label: string
  kind: TransferKind
  hostId: string
  total: number
  done: number
  failed: number
  size: number
  bytes: number
  state: TransferState
}

export interface EnqueueRequest {
  kind: 'upload' | 'download' | 'delete-remote' | 'delete-local'
  hostId: string
  localPath: string
  remotePath: string
  source?: TransferSource
  /** Skip the "compare before overwriting" check. */
  force?: boolean
}

export interface ProgressBatch {
  jobs: { id: string; bytes: number; speedBps: number }[]
  groups: { id: string; bytes: number; done: number }[]
}

export interface TransferLogEntry {
  at: number
  level: 'info' | 'error'
  message: string
}

/* ---------- Compare ---------- */

export interface CompareSide {
  text: string
  eol: '\n' | '\r\n'
  bom: boolean
  trailingNewline: boolean
  mtime: number
  size: number
  exists: boolean
}

export interface CompareLoadRequest {
  hostId: string
  localPath: string
  remotePath: string
}

export interface CompareLoadResult {
  local: CompareSide
  remote: CompareSide
  remoteNewerThanSnapshot: boolean
}

export interface CompareWriteRequest {
  hostId: string
  path: string
  /** The file on the other side, used to record the synced state. */
  otherPath?: string
  text: string
  expectedMtime: number
  expectedSize: number
}

/* ---------- Terminal ---------- */

export type TerminalOpenRequest =
  | { kind: 'ssh'; hostId: string; cols: number; rows: number }
  | { kind: 'local'; cwd?: string; cols: number; rows: number }

export interface SessionInfo {
  kind: 'ssh' | 'local'
  title: string
  hostId?: string
  host?: string
  port?: number
  user?: string
  auth?: string
  cipher?: string
  latencyMs?: number
  cwd?: string
  shell?: string
  cols: number
  rows: number
  startedAt: number
}

/* ---------- Sync ---------- */

export type SyncKind = 'upload' | 'download' | 'delete-remote' | 'conflict' | 'failed'
export type SyncGroup = 'wait' | 'attn' | 'done'

export interface SyncItem {
  id: string
  projectId: string
  hostId: string
  kind: SyncKind
  /** What the failed item was trying to do. */
  action?: 'upload' | 'download' | 'delete-remote'
  relPath: string
  localPath: string
  remotePath: string
  size: number
  reason: string
  localInfo: string
  remoteInfo: string
  group: SyncGroup
  updatedAt: number
}

/** How a file differs between the local mapping and the server, judged against the last sync. */
export type SyncStatus = 'local-changed' | 'remote-changed' | 'conflict' | 'local-only' | 'remote-only'
export type SyncAction = 'upload' | 'download' | 'skip'

export interface SyncDiff {
  /** Path relative to its mapping root, forward slashes. */
  relPath: string
  localPath: string
  remotePath: string
  status: SyncStatus
  local: { size: number; mtime: number } | null
  remote: { size: number; mtime: number } | null
  /** Suggested action: follows the sync history; conflicts and one-sided files wait for the user. */
  action: SyncAction
}

export interface SyncCompareRequest {
  hostId: string
  /** Limits the comparison to one file or folder; the host's whole mappings when absent. */
  scope?: { localPath: string; remotePath: string; isDir: boolean }
}

/** What a Sync window compares: a host's whole mappings, or one file or folder. */
export interface SyncWindowRequest {
  hostId: string
  scope?: SyncCompareRequest['scope']
}

export interface SyncApplyRequest {
  hostId: string
  items: { localPath: string; remotePath: string; action: 'upload' | 'download' }[]
}

/* ---------- App state snapshot ---------- */

export interface AppState {
  settings: Settings
  projects: Project[]
  hosts: Host[]
  snippets: Snippet[]
  conns: HostConn[]
  jobs: TransferJob[]
  groups: TransferGroup[]
  log: TransferLogEntry[]
  sessions: { id: string; info: SessionInfo }[]
  sync: SyncItem[]
  secretsAvailable: boolean
  platform: string
  homeDir: string
}

export interface HostSaveRequest {
  host: Host
  secret?: { value: string; save: boolean } | null
}

export interface TestResult {
  ok: boolean
  serverVersion?: string
  latencyMs?: number
  error?: string
}
