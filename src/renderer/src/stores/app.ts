import { create } from 'zustand'
import type { AppState, Host, HostConn, Project, Settings, Snippet } from '@shared/types'
import { invoke } from '../lib/ipc'

interface AppStore {
  ready: boolean
  settings: Settings
  projects: Project[]
  hosts: Host[]
  snippets: Snippet[]
  conns: Record<string, HostConn>
  secretsAvailable: boolean
  platform: string
  home: string
  init: (s: AppState) => void
  applyStore: (p: { projects: Project[]; hosts: Host[]; settings: Settings; snippets: Snippet[] }) => void
  setConn: (c: HostConn) => void
  updateSettings: (patch: Partial<Settings>) => Promise<void>
}

export const useApp = create<AppStore>((set) => ({
  ready: false,
  settings: { theme: 'dark', reduceTransparency: false, defaultConcurrency: 3 },
  projects: [],
  hosts: [],
  snippets: [],
  conns: {},
  secretsAvailable: true,
  platform: 'darwin',
  home: '',
  init: (s) =>
    set({
      ready: true,
      settings: s.settings,
      projects: s.projects,
      hosts: s.hosts,
      snippets: s.snippets,
      conns: Object.fromEntries(s.conns.map((c) => [c.hostId, c])),
      secretsAvailable: s.secretsAvailable,
      platform: s.platform,
      home: s.homeDir
    }),
  applyStore: (p) => set(p),
  setConn: (c) => set((st) => ({ conns: { ...st.conns, [c.hostId]: c } })),
  updateSettings: async (patch) => {
    set((st) => ({ settings: { ...st.settings, ...patch } }))
    const settings = await invoke('app:updateSettings', patch)
    set({ settings })
  }
}))

// Selectors must return stable references, so empty states are cached per host.
const emptyConns = new Map<string, HostConn>()
const EMPTY_CONN = (hostId: string): HostConn => {
  let c = emptyConns.get(hostId)
  if (!c) emptyConns.set(hostId, (c = { hostId, state: 'disconnected', attempt: 0, maxAttempts: 5, info: {} }))
  return c
}

export function useActiveProject(): Project | undefined {
  return useApp((s) => s.projects.find((p) => p.id === s.settings.activeProjectId))
}

export function useProjectHosts(): Host[] {
  const pid = useApp((s) => s.settings.activeProjectId)
  const hosts = useApp((s) => s.hosts)
  return hosts.filter((h) => h.projectId === pid)
}

export function useActiveHost(): Host | undefined {
  return useApp((s) => {
    const inProject = s.hosts.filter((h) => h.projectId === s.settings.activeProjectId)
    return inProject.find((h) => h.id === s.settings.activeHostId) ?? inProject[0]
  })
}

export function useConn(hostId: string | undefined): HostConn {
  return useApp((s) => (hostId ? (s.conns[hostId] ?? EMPTY_CONN(hostId)) : EMPTY_CONN('')))
}

export function getActiveHost(): Host | undefined {
  const s = useApp.getState()
  const inProject = s.hosts.filter((h) => h.projectId === s.settings.activeProjectId)
  return inProject.find((h) => h.id === s.settings.activeHostId) ?? inProject[0]
}

export function getActiveProject(): Project | undefined {
  const s = useApp.getState()
  return s.projects.find((p) => p.id === s.settings.activeProjectId)
}
