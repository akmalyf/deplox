import { useEffect } from 'react'
import { useApp } from './stores/app'
import { Shell } from './shell/Shell'
import { SyncWindow } from './views/sync/SyncWindow'
import { syncRoute } from './lib/route'
import { applyTheme } from './lib/theme'

export function App() {
  const ready = useApp((s) => s.ready)
  const settings = useApp((s) => s.settings)
  useEffect(() => applyTheme(settings), [settings])
  if (!ready) return null
  return syncRoute ? <SyncWindow req={syncRoute} /> : <Shell />
}
