import type { Host } from '@shared/types'
import { id as newId } from '@shared/ids'
import { handle } from './register'
import type { Services } from '../services'
import type { StoredHost } from '../store/schema'
import { secretRef } from '../store/secrets'
import { toRemoteFsError } from '../remote/errors'

function toStored(h: Host): StoredHost {
  const { hasSecret: _hasSecret, ...auth } = h.auth
  return {
    ...h,
    name: h.name.trim() || h.host,
    host: h.host.trim(),
    username: h.username.trim(),
    port: Number(h.port) || (h.protocol === 'sftp' ? 22 : 21),
    auth,
    mappings: h.mappings.filter((m) => m.local.trim() || m.remote.trim()),
    excluded: [...new Set(h.excluded.map((x) => x.trim()).filter(Boolean))]
  }
}

const CONNECTION_KEYS: (keyof StoredHost)[] = ['protocol', 'host', 'port', 'username']

export function registerHosts(s: Services): void {
  handle('hosts:save', async ({ host, secret }) => {
    if (!host.host.trim()) throw new Error('[EUNKNOWN] Host is required')
    const stored = toStored(host)
    const prev = s.getHost(stored.id)
    s.store.update((st) => ({
      ...st,
      hosts: prev ? st.hosts.map((h) => (h.id === stored.id ? stored : h)) : [...st.hosts, stored]
    }))
    const kind = stored.auth.method === 'key' ? 'passphrase' : 'password'
    if (secret && secret.value) s.secrets.set(secretRef(stored.id, kind), secret.value, secret.save)
    else if (secret && !secret.save) s.secrets.deleteStored(secretRef(stored.id, kind))

    const changed =
      prev &&
      (CONNECTION_KEYS.some((k) => JSON.stringify(prev[k]) !== JSON.stringify(stored[k])) ||
        JSON.stringify(prev.auth) !== JSON.stringify(stored.auth) ||
        JSON.stringify(prev.ftp) !== JSON.stringify(stored.ftp) ||
        !!secret?.value)
    if (changed) await s.conns.disconnect(stored.id)
    if (!prev && stored.projectId === s.store.get().settings.activeProjectId) await s.sync.setWatching(stored.projectId, true)
    s.broadcastStore()
    return s.publicHosts()
  })

  handle('hosts:delete', async (id) => {
    const h = s.getHost(id)
    s.conns.forget(id)
    s.queue.dropHost(id)
    s.secrets.deleteHost(id)
    s.sync.dropHost(id)
    s.snapshots.dropHost(id)
    s.store.update((st) => ({
      ...st,
      hosts: st.hosts.filter((x) => x.id !== id),
      settings: st.settings.activeHostId === id ? { ...st.settings, activeHostId: st.hosts.find((x) => x.id !== id && x.projectId === h?.projectId)?.id } : st.settings
    }))
    s.broadcastStore()
    return s.publicHosts()
  })

  handle('hosts:duplicate', (id) => {
    const h = s.getHost(id)
    if (!h) throw new Error('[ENOENT] Host not found')
    const copy: StoredHost = { ...structuredClone(h), id: newId('h'), name: `${h.name} copy`, lastConnectedAt: undefined }
    s.store.update((st) => ({ ...st, hosts: [...st.hosts, copy] }))
    s.secrets.copyHost(id, copy.id)
    s.broadcastStore()
    return s.publicHosts()
  })

  handle('hosts:test', async ({ host, secret }) => {
    try {
      const stored = toStored(host)
      const kind = stored.auth.method === 'key' ? 'passphrase' : 'password'
      const value = secret?.value || s.secrets.get(secretRef(stored.id, kind))
      const r = await s.conns.test(stored, value)
      return { ok: true, serverVersion: r.serverVersion, latencyMs: r.latencyMs }
    } catch (e) {
      return { ok: false, error: toRemoteFsError(e).detail }
    }
  })

  handle('hosts:connect', async (id) => {
    s.store.update((st) => ({ ...st, settings: { ...st.settings, activeHostId: id } }))
    try {
      await s.conns.connect(id, { interactive: true })
    } catch {
      /* the state carries the error */
    }
    return s.conns.state(id)
  })

  handle('hosts:disconnect', async (id) => {
    await s.conns.disconnect(id)
    return s.conns.state(id)
  })
}
