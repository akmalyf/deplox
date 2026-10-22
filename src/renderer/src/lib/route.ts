import type { SyncWindowRequest } from '@shared/types'

/** Set when this renderer runs in a Sync window (opened with #sync=<request>) instead of the main window. */
export const syncRoute: SyncWindowRequest | null = (() => {
  const m = /^#sync=(.+)$/.exec(window.location.hash)
  if (!m) return null
  try {
    return JSON.parse(decodeURIComponent(m[1])) as SyncWindowRequest
  } catch {
    return null
  }
})()
