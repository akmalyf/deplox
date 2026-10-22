import type { EnqueueRequest, Host, Project } from '@shared/types'
import { basename, expandHome, normLocal, posixDirname, posixJoin, posixNormalize } from '@shared/paths'
import { invoke, errorText } from './ipc'
import { useApp, getActiveHost, getActiveProject } from '../stores/app'
import { useBrowser, counterpart, parentOf, type Side } from '../stores/browser'
import { useUi, toast } from '../stores/ui'
import { useTerminal } from '../stores/terminal'

export function hostRoots(host: Host | undefined, project: Project | undefined): { local: string; remote: string } {
  const home = useApp.getState().home
  const m = host?.mappings[0]
  const local = m?.local ? normLocal(expandHome(m.local, home)) : project ? normLocal(expandHome(project.localRoot, home)) : home
  const remote = m?.remote ? posixNormalize(m.remote) : ''
  return { local, remote }
}

export async function connectHost(hostId: string): Promise<boolean> {
  const st = await invoke('hosts:connect', hostId)
  useApp.getState().setConn(st)
  if (st.state !== 'connected' && st.error && st.state !== 'auth-failed') toast(st.error, 'danger')
  return st.state === 'connected'
}

export async function selectHost(hostId: string): Promise<void> {
  await useApp.getState().updateSettings({ activeHostId: hostId })
  void connectHost(hostId)
}

function remoteRootFor(): string {
  return useBrowser.getState().remote.root
}

/** Selected paths of a side, mapped to the target side. */
function pairsFor(fromSide: Side): { local: string; remote: string }[] {
  const b = useBrowser.getState()
  const sel = [...b[fromSide].selected]
  const out: { local: string; remote: string }[] = []
  for (const p of sel) {
    const cp = counterpart(fromSide, p, b.local.root, b.remote.root)
    if (!cp) continue
    out.push(fromSide === 'local' ? { local: p, remote: cp } : { local: cp, remote: p })
  }
  return out
}

async function enqueue(reqs: EnqueueRequest[]): Promise<void> {
  if (!reqs.length) return
  try {
    useBrowser.getState().setTransfersOpen(true)
    await invoke('transfers:enqueue', reqs)
  } catch (e) {
    toast(errorText(e), 'danger')
  }
}

export async function uploadSelection(side?: Side): Promise<void> {
  const host = getActiveHost()
  if (!host) return
  const b = useBrowser.getState()
  const from = side ?? (b.local.selected.size ? 'local' : 'remote')
  if (!b.remote.root) return toast('Set a deployment path for this host first', 'danger')
  const pairs = pairsFor(from)
  if (!pairs.length) return toast('Select files to upload', 'neutral')
  confirmTransfer('upload', host.name, pairs.map((p) => p.remote), () => enqueue(pairs.map((p) => ({ kind: 'upload', hostId: host.id, localPath: p.local, remotePath: p.remote }))))
}

export async function downloadSelection(side?: Side): Promise<void> {
  const host = getActiveHost()
  if (!host) return
  const b = useBrowser.getState()
  const from = side ?? (b.remote.selected.size ? 'remote' : 'local')
  const pairs = pairsFor(from)
  if (!pairs.length) return toast('Select files to download', 'neutral')
  confirmTransfer('download', host.name, pairs.map((p) => p.local), () => enqueue(pairs.map((p) => ({ kind: 'download', hostId: host.id, localPath: p.local, remotePath: p.remote }))))
}

/** Asks before a manual transfer overwrites the other side; lists the targets it will write. */
function confirmTransfer(kind: 'upload' | 'download', hostName: string, targets: string[], run: () => Promise<void>): void {
  const n = targets.length
  const what = n === 1 ? basename(targets[0]) : `${n} items`
  const shown = targets.slice(0, 8).join('\n') + (n > 8 ? `\n… and ${n - 8} more` : '')
  useUi.getState().askConfirm(
    kind === 'upload'
      ? { title: `Upload ${what} to ${hostName}?`, description: 'Files on the server are replaced with your local copies. Folders are uploaded with everything inside.', detail: shown, confirm: 'Upload', run }
      : { title: `Download ${what} from ${hostName}?`, description: 'Your local files are replaced with the server copies. Folders are downloaded with everything inside.', detail: shown, confirm: 'Download', run }
  )
}

export async function uploadPath(localPath: string): Promise<void> {
  const host = getActiveHost()
  const b = useBrowser.getState()
  const remote = host ? counterpart('local', localPath, b.local.root, b.remote.root) : null
  if (host && remote) await enqueue([{ kind: 'upload', hostId: host.id, localPath, remotePath: remote }])
}

/** Opens a Sync window for the focused file or folder of a pane. */
export function syncSelection(side?: Side): void {
  const host = getActiveHost()
  const b = useBrowser.getState()
  const s = side ?? b.activeSide
  const path = b[s].focused ?? [...b[s].selected][0]
  if (!host || !path) return toast('Select a file or folder to sync', 'neutral')
  const entry = Object.values(b[s].entries).flat().find((e) => e.path === path)
  const cp = counterpart(s, path, b.local.root, b.remote.root)
  if (!cp) return toast('This path is outside the mapping', 'danger')
  void invoke('app:openSyncWindow', { hostId: host.id, scope: { localPath: s === 'local' ? path : cp, remotePath: s === 'remote' ? path : cp, isDir: entry?.type === 'dir' } })
}

/** Opens a Sync window over the active host's whole mappings. */
export function syncAll(): void {
  const host = getActiveHost()
  if (!host) return
  if (!host.mappings.some((m) => m.local.trim() && m.remote.trim())) return toast('Set a deployment path for this host first', 'danger')
  void invoke('app:openSyncWindow', { hostId: host.id })
}

/** Opens a Sync window on one file pair. */
export function openFileSync(pair: { hostId: string; localPath: string; remotePath: string }): void {
  void invoke('app:openSyncWindow', { hostId: pair.hostId, scope: { localPath: pair.localPath, remotePath: pair.remotePath, isDir: false } })
}

export async function openSsh(hostId?: string, cwd?: string): Promise<void> {
  const host = hostId ? useApp.getState().hosts.find((h) => h.id === hostId) : getActiveHost()
  if (!host) return
  if (host.protocol !== 'sftp') return toast(`${host.name} uses ${host.protocol.toUpperCase()}: SSH sessions need an SFTP host`, 'danger')
  useUi.getState().setView('terminal')
  try {
    const r = await invoke('terminal:open', { kind: 'ssh', hostId: host.id, cols: 120, rows: 36 })
    useTerminal.getState().add({ id: r.sessionId, info: r.info })
    if (cwd) window.deplox.send('terminal:write', { sessionId: r.sessionId, data: `cd '${cwd.replace(/'/g, "'\\''")}'\n` })
  } catch (e) {
    toast(errorText(e), 'danger')
  }
}

export async function openLocalTerminal(cwd?: string): Promise<void> {
  useUi.getState().setView('terminal')
  try {
    const r = await invoke('terminal:open', { kind: 'local', cwd: cwd ?? getActiveProject()?.localRoot, cols: 120, rows: 36 })
    useTerminal.getState().add({ id: r.sessionId, info: r.info })
  } catch (e) {
    toast(errorText(e), 'danger')
  }
}

export function deletePaths(side: Side, paths: string[]): void {
  const host = getActiveHost()
  if (!paths.length) return
  const names = paths.map((p) => basename(p))
  const many = paths.length > 1
  useUi.getState().askConfirm({
    title: side === 'remote' ? `Delete ${many ? `${paths.length} items` : names[0]} from ${host?.name ?? 'the server'}?` : `Move ${many ? `${paths.length} items` : names[0]} to the Trash?`,
    description: side === 'remote' ? 'Removed from the server only. Your local copy stays. This can’t be undone.' : 'Your local copy moves to the Trash. The server copy stays.',
    detail: paths.slice(0, 6).join('\n') + (paths.length > 6 ? `\n… and ${paths.length - 6} more` : ''),
    confirm: side === 'remote' ? 'Delete from server' : 'Move to Trash',
    danger: true,
    run: async () => {
      try {
        if (side === 'remote' && host) {
          await invoke('transfers:enqueue', paths.map((p) => ({ kind: 'delete-remote' as const, hostId: host.id, localPath: '', remotePath: p })))
        } else {
          for (const p of paths) await invoke('local:delete', p)
          useBrowser.getState().refreshPaths('local', paths)
          toast(`${many ? `${paths.length} items` : names[0]} moved to the Trash`)
        }
        useBrowser.getState().clearSelection(side)
      } catch (e) {
        toast(errorText(e), 'danger')
      }
    }
  })
}

function targetDir(side: Side): string {
  const b = useBrowser.getState()
  const p = b[side]
  const f = p.focused
  if (!f) return p.root
  const entry = Object.values(p.entries).flat().find((e) => e.path === f)
  return entry?.type === 'dir' ? f : parentOf(side, f)
}

export function newFolder(side: Side): void {
  const host = getActiveHost()
  const dir = targetDir(side)
  if (!dir) return
  useUi.getState().askInput({
    title: side === 'remote' ? `New folder on ${host?.name ?? 'server'}` : 'New local folder',
    description: dir,
    label: 'Folder name',
    confirm: 'Create',
    validate: (v) => (!v.trim() ? 'Enter a name' : /[/\\]/.test(v) ? 'Use a name without slashes' : null),
    run: async (name) => {
      try {
        if (side === 'remote' && host) await invoke('remote:mkdir', { hostId: host.id, path: posixJoin(dir, name.trim()) })
        else await invoke('local:mkdir', `${dir.replace(/[\\/]+$/, '')}/${name.trim()}`)
        const b = useBrowser.getState()
        useBrowser.setState({ [side]: { ...b[side], expanded: { ...b[side].expanded, [dir]: true } } })
        await b.load(side, dir, true)
      } catch (e) {
        toast(errorText(e), 'danger')
      }
    }
  })
}

export function renamePath(side: Side, path: string): void {
  const host = getActiveHost()
  const name = basename(path)
  useUi.getState().askInput({
    title: `Rename ${name}`,
    label: 'New name',
    value: name,
    confirm: 'Rename',
    validate: (v) => (!v.trim() ? 'Enter a name' : /[/\\]/.test(v) ? 'Use a name without slashes' : null),
    run: async (next) => {
      if (next === name) return
      try {
        if (side === 'remote' && host) await invoke('remote:rename', { hostId: host.id, from: path, to: posixJoin(posixDirname(path), next.trim()) })
        else await invoke('local:rename', { from: path, to: `${parentOf('local', path)}/${next.trim()}` })
        useBrowser.getState().refreshPaths(side, [path])
      } catch (e) {
        toast(errorText(e), 'danger')
      }
    }
  })
}

export async function copyText(text: string, what = 'Path'): Promise<void> {
  await invoke('app:copyText', text)
  toast(`${what} copied`)
}

export function hostAddress(h: Host): string {
  return `${h.protocol}://${h.username ? h.username + '@' : ''}${h.host}:${h.port}`
}

export { remoteRootFor }
