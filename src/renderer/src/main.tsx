import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@xterm/xterm/css/xterm.css'
import './styles/tokens.css'
import './styles/bundle.css'
import './styles/app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { bindEvents } from './stores/bindEvents'
import { useApp } from './stores/app'
import { useTransfers } from './stores/transfers'
import { useTerminal } from './stores/terminal'
import { useSync } from './stores/sync'
import { installKeymap } from './lib/keymap'
import { applyTheme } from './lib/theme'
import { syncRoute } from './lib/route'

// Platform class for chrome that depends on native window controls.
document.documentElement.classList.toggle('mac', window.deplox.platform === 'darwin')
bindEvents()
// App shortcuts drive the main window's views; a Sync window has its own keys.
if (!syncRoute) installKeymap()

void window.deplox.invoke('app:getState').then((s) => {
  applyTheme(s.settings)
  useApp.getState().init(s)
  useTransfers.getState().init(s.jobs, s.groups, s.log)
  useTerminal.getState().init(s.sessions)
  useSync.getState().setItems(s.sync)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
