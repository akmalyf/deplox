import { useEffect } from 'react'
import { useApp } from './stores/app'
import { Shell } from './shell/Shell'
import { applyTheme } from './lib/theme'

export function App() {
  const ready = useApp((s) => s.ready)
  const settings = useApp((s) => s.settings)
  useEffect(() => applyTheme(settings), [settings])
  if (!ready) return null
  return <Shell />
}
