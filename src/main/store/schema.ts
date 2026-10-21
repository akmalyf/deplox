import type { Host, Project, Settings, Snippet } from '@shared/types'

export const CURRENT_VERSION = 1

/** Host as persisted: never carries plaintext secrets. */
export type StoredHost = Omit<Host, 'auth'> & { auth: Omit<Host['auth'], 'hasSecret'> }

export interface StoreV1 {
  version: 1
  settings: Settings
  projects: Project[]
  hosts: StoredHost[]
  snippets: Snippet[]
  /** secretRef → base64(safeStorage.encryptString(value)) */
  secrets: Record<string, string>
}

export const DEFAULT_SNIPPETS: Snippet[] = [
  { id: 'sn_1', label: 'php artisan optimize:clear', command: 'php artisan optimize:clear' },
  { id: 'sn_2', label: 'php artisan queue:restart', command: 'php artisan queue:restart' },
  { id: 'sn_3', label: 'tail -f storage/logs/laravel.log', command: 'tail -f storage/logs/laravel.log' }
]

export function defaultStore(): StoreV1 {
  return {
    version: 1,
    settings: { theme: 'dark', reduceTransparency: false, defaultConcurrency: 3 },
    projects: [],
    hosts: [],
    snippets: DEFAULT_SNIPPETS,
    secrets: {}
  }
}
