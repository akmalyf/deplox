import { CURRENT_VERSION, defaultStore, type StoreV1 } from './schema'

type Migration = (data: Record<string, unknown>) => Record<string, unknown>

/** migrations[n] upgrades version n → n+1. */
const migrations: Migration[] = [
  // v0 (no version field) → v1
  (d) => ({ ...defaultStore(), ...d, version: 1 })
]

export function migrateStore(raw: unknown): StoreV1 {
  let data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  let v = typeof data.version === 'number' ? data.version : 0
  if (v > CURRENT_VERSION) throw new Error(`store version ${v} is newer than this app (${CURRENT_VERSION})`)
  while (v < CURRENT_VERSION) {
    data = migrations[v](data)
    v++
  }
  const def = defaultStore()
  const s = data as unknown as StoreV1
  return {
    ...def,
    ...s,
    settings: { ...def.settings, ...s.settings },
    projects: s.projects ?? [],
    hosts: s.hosts ?? [],
    snippets: s.snippets ?? def.snippets,
    secrets: s.secrets ?? {}
  }
}
