import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Host } from '@shared/types'
import { JsonStore } from './store/JsonStore'
import { defaultStore, type StoreV1, type StoredHost } from './store/schema'
import { migrateStore } from './store/migrations'
import { Secrets, secretRef } from './store/secrets'
import { KnownHosts } from './store/knownHosts'
import { Prompter } from './remote/Prompter'
import { ConnectionManager } from './remote/ConnectionManager'
import { TransferQueue } from './transfers/TransferQueue'
import { TerminalManager } from './terminal/TerminalManager'
import { Snapshots } from './sync/snapshot'
import { SyncEngine } from './sync/SyncEngine'
import { emit } from './events'

export interface Services {
  home: string
  store: JsonStore<StoreV1>
  secrets: Secrets
  knownHosts: KnownHosts
  prompter: Prompter
  conns: ConnectionManager
  queue: TransferQueue
  terminals: TerminalManager
  snapshots: Snapshots
  sync: SyncEngine
  getHost(id: string): StoredHost | undefined
  publicHosts(): Host[]
  broadcastStore(): void
}

export function createServices(): Services {
  const dir = app.getPath('userData')
  const home = homedir()
  const store = new JsonStore<StoreV1>(join(dir, 'store.json'), defaultStore, migrateStore)
  const secrets = new Secrets(store)
  const knownHosts = new KnownHosts(join(dir, 'known_hosts.json'))
  const prompter = new Prompter()
  const getHost = (id: string) => store.get().hosts.find((h) => h.id === id)
  const conns = new ConnectionManager({ getHost, secrets, knownHosts, prompter })
  const snapshots = new Snapshots(join(dir, 'sync-snapshot.json'))

  // The queue and the sync engine reference each other through callbacks.
  let sync: SyncEngine | null = null
  const queue = new TransferQueue({
    conns,
    prompter,
    getHost,
    home,
    file: join(dir, 'transfers.json'),
    defaultConcurrency: () => store.get().settings.defaultConcurrency,
    overwriteReason: (host, _local, local, remote) => snapshots.overwriteReason(host.id, remote.path, local, remote),
    onJobDone: (job, host) => void sync?.onJobDone(job, host),
    onJobFailed: (job, host) => sync?.onJobFailed(job, host)
  })
  sync = new SyncEngine({
    conns,
    queue,
    snapshots,
    home,
    hostsOf: (projectId) => store.get().hosts.filter((h) => h.projectId === projectId),
    getHost
  })
  const terminals = new TerminalManager(conns, {
    getHost,
    shell: () => store.get().settings.shell,
    defaultCwd: () => {
      const s = store.get()
      return s.projects.find((p) => p.id === s.settings.activeProjectId)?.localRoot.replace(/^~/, home)
    }
  })

  conns.on('state', (s) => emit('conn:state', s))
  conns.on('connected', (hostId: string) => {
    store.update((s) => ({ ...s, hosts: s.hosts.map((h) => (h.id === hostId ? { ...h, lastConnectedAt: Date.now() } : h)) }))
  })

  const publicHosts = (): Host[] =>
    store.get().hosts.map((h) => ({
      ...h,
      auth: {
        ...h.auth,
        hasSecret: secrets.hasStored(secretRef(h.id, h.auth.method === 'key' ? 'passphrase' : 'password'))
      }
    }))

  const broadcastStore = () => {
    const s = store.get()
    emit('store:changed', { projects: s.projects, hosts: publicHosts(), settings: s.settings, snippets: s.snippets })
  }

  return { home, store, secrets, knownHosts, prompter, conns, queue, terminals, snapshots, sync, getHost, publicHosts, broadcastStore }
}
