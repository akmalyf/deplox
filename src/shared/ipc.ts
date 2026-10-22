import type {
  AppState,
  CompareLoadRequest,
  CompareLoadResult,
  CompareWriteRequest,
  EnqueueRequest,
  FsEntry,
  SyncApplyRequest,
  SyncCompareRequest,
  SyncDiff,
  SyncWindowRequest,
  Host,
  HostConn,
  HostSaveRequest,
  ProgressBatch,
  Project,
  PromptAnswer,
  PromptRequest,
  SessionInfo,
  Settings,
  Snippet,
  SyncItem,
  TerminalOpenRequest,
  TestResult,
  TransferGroup,
  TransferJob,
  TransferLogEntry
} from './types'

/** Request/response channels: [request, response]. */
export interface InvokeMap {
  'app:getState': [void, AppState]
  'app:updateSettings': [Partial<Settings>, Settings]
  'app:pickPath': [{ kind: 'file' | 'folder'; defaultPath?: string; title?: string }, string | null]
  'app:revealPath': [string, void]
  'app:copyText': [string, void]
  'app:openSyncWindow': [SyncWindowRequest, void]

  'projects:save': [Project, Project[]]
  'projects:delete': [string, Project[]]
  'projects:open': [string, Settings]

  'hosts:save': [HostSaveRequest, Host[]]
  'hosts:delete': [string, Host[]]
  'hosts:duplicate': [string, Host[]]
  'hosts:test': [HostSaveRequest, TestResult]
  /** Lists folders over a throwaway connection made from unsaved form values; an empty path is the login folder. */
  'hosts:browse': [HostSaveRequest & { session: string; path: string }, { path: string; entries: FsEntry[] }]
  'hosts:browseEnd': [string, void]
  'hosts:connect': [string, HostConn]
  'hosts:disconnect': [string, HostConn]

  'prompt:answer': [{ requestId: string; answer: PromptAnswer }, void]

  'local:list': [string, FsEntry[]]
  'local:stat': [string, FsEntry | null]
  'local:mkdir': [string, void]
  'local:rename': [{ from: string; to: string }, void]
  'local:delete': [string, void]
  'local:home': [void, string]

  'remote:list': [{ hostId: string; path: string }, FsEntry[]]
  'remote:stat': [{ hostId: string; path: string }, FsEntry | null]
  'remote:mkdir': [{ hostId: string; path: string }, void]
  'remote:rename': [{ hostId: string; from: string; to: string }, void]
  'remote:delete': [{ hostId: string; path: string }, void]
  'remote:realpath': [{ hostId: string; path: string }, string]

  'transfers:enqueue': [EnqueueRequest[], TransferJob[]]
  'transfers:cancel': [string[], void]
  'transfers:pause': [string[], void]
  'transfers:resume': [string[], void]
  'transfers:retry': [{ ids: string[]; restart?: boolean }, void]
  'transfers:remove': [string[], void]
  'transfers:pauseAll': [void, void]
  'transfers:resumeAll': [void, void]
  'transfers:clearDone': [void, void]

  'compare:load': [CompareLoadRequest, CompareLoadResult]
  'compare:writeRemote': [CompareWriteRequest, { mtime: number; size: number }]
  'compare:writeLocal': [Omit<CompareWriteRequest, 'hostId'> & { hostId?: string }, { mtime: number; size: number }]

  'terminal:open': [TerminalOpenRequest, { sessionId: string; info: SessionInfo }]
  'terminal:close': [string, void]

  'sync:scan': [string, SyncItem[]]
  'sync:compare': [SyncCompareRequest, SyncDiff[]]
  'sync:apply': [SyncApplyRequest, void]
  'sync:run': [string[], void]
  'sync:remove': [string[], void]
  'sync:resolve': [{ id: string; resolution: 'upload' | 'download' }, void]
  'sync:clearDone': [void, void]
  'sync:setWatching': [{ projectId: string; on: boolean }, void]

  'snippets:save': [Snippet[], Snippet[]]
}

/** Fire-and-forget renderer → main. */
export interface SendMap {
  'terminal:write': { sessionId: string; data: string }
  'terminal:resize': { sessionId: string; cols: number; rows: number }
  'terminal:ack': { sessionId: string; bytes: number }
}

/** Main → renderer events. */
export interface EventMap {
  'conn:state': HostConn
  'prompt:open': PromptRequest
  'prompt:cancel': { requestId: string }
  'store:changed': { projects: Project[]; hosts: Host[]; settings: Settings; snippets: Snippet[] }
  'transfers:update': { jobs: TransferJob[]; groups: TransferGroup[]; removed?: string[] }
  'transfers:progress': ProgressBatch
  'transfers:log': TransferLogEntry
  'terminal:data': { sessionId: string; chunk: Uint8Array }
  'terminal:exit': { sessionId: string; code: number | null; reason?: string }
  'terminal:info': { sessionId: string; info: SessionInfo }
  'sync:items': { items: SyncItem[] }
  'app:toast': { text: string; tone?: 'neutral' | 'danger' | 'success' }
  'app:openCompare': { hostId: string; localPath: string; remotePath: string }
  /** Sent only to the window that entered or left native full screen. */
  'window:fullscreen': { fullScreen: boolean }
}

export type InvokeChannel = keyof InvokeMap
export type SendChannel = keyof SendMap
export type EventChannel = keyof EventMap

export const INVOKE_CHANNELS = [
  'app:getState', 'app:updateSettings', 'app:pickPath', 'app:revealPath', 'app:copyText', 'app:openSyncWindow',
  'projects:save', 'projects:delete', 'projects:open',
  'hosts:save', 'hosts:delete', 'hosts:duplicate', 'hosts:test', 'hosts:browse', 'hosts:browseEnd', 'hosts:connect', 'hosts:disconnect',
  'prompt:answer',
  'local:list', 'local:stat', 'local:mkdir', 'local:rename', 'local:delete', 'local:home',
  'remote:list', 'remote:stat', 'remote:mkdir', 'remote:rename', 'remote:delete', 'remote:realpath',
  'transfers:enqueue', 'transfers:cancel', 'transfers:pause', 'transfers:resume', 'transfers:retry',
  'transfers:remove', 'transfers:pauseAll', 'transfers:resumeAll', 'transfers:clearDone',
  'compare:load', 'compare:writeRemote', 'compare:writeLocal',
  'terminal:open', 'terminal:close',
  'sync:scan', 'sync:compare', 'sync:apply', 'sync:run', 'sync:remove', 'sync:resolve', 'sync:clearDone', 'sync:setWatching',
  'snippets:save'
] as const satisfies readonly InvokeChannel[]

export const SEND_CHANNELS = ['terminal:write', 'terminal:resize', 'terminal:ack'] as const satisfies readonly SendChannel[]

export const EVENT_CHANNELS = [
  'conn:state', 'prompt:open', 'prompt:cancel', 'store:changed',
  'transfers:update', 'transfers:progress', 'transfers:log',
  'terminal:data', 'terminal:exit', 'terminal:info',
  'sync:items', 'app:toast', 'app:openCompare', 'window:fullscreen'
] as const satisfies readonly EventChannel[]

/** Errors crossing IPC are serialized as `[CODE] message`. */
export interface IpcError {
  code: string
  message: string
}

export function parseIpcError(err: unknown): IpcError {
  const raw = err instanceof Error ? err.message : String(err)
  // Electron prefixes: "Error invoking remote method 'x': Error: [CODE] msg"
  const m = /\[([A-Z_]+)\]\s*([\s\S]*)$/.exec(raw)
  if (m) return { code: m[1], message: m[2] }
  return { code: 'EUNKNOWN', message: raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '') }
}

export interface DeploxApi {
  invoke<K extends InvokeChannel>(channel: K, ...req: InvokeMap[K][0] extends void ? [] : [InvokeMap[K][0]]): Promise<InvokeMap[K][1]>
  send<K extends SendChannel>(channel: K, payload: SendMap[K]): void
  on<K extends EventChannel>(channel: K, cb: (payload: EventMap[K]) => void): () => void
  platform: string
}
