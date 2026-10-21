import { Suspense, useEffect } from 'react'
import { useApp, useActiveProject } from '../stores/app'
import { useUi } from '../stores/ui'
import { glassEnabled } from '../lib/theme'
import { HostSidebar } from './HostSidebar'
import { CommandPalette } from './CommandPalette'
import { PromptDialogs } from './dialogs/PromptDialogs'
import { ConfirmDialog, InputDialog, Toasts } from './dialogs/CommonDialogs'
import { ProjectDialog } from './dialogs/ProjectDialog'
import { BrowserView } from '../views/browser/BrowserView'
import { WelcomeView } from '../views/WelcomeView'
import { CompareView } from '../views/compare/CompareView'
import { TerminalView } from '../views/terminal/TerminalView'
import { SyncQueueView } from '../views/sync/SyncQueueView'
import { HostForm } from '../views/host/HostForm'
import { SettingsView } from '../views/SettingsView'
import { ErrorBoundary } from './ErrorBoundary'

// Views are bundled statically: chunks loaded from disk gain nothing from splitting,
// and a rebuild would otherwise leave an open window pointing at deleted chunk files.

export function Shell() {
  const view = useUi((s) => s.view)
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const settings = useApp((s) => s.settings)
  const secretsAvailable = useApp((s) => s.secretsAvailable)
  const project = useActiveProject()
  const hasProjects = useApp((s) => s.projects.length > 0)

  useEffect(() => {
    if (!hasProjects && view !== 'settings') useUi.getState().setView('welcome')
    else if (hasProjects && view === 'welcome') useUi.getState().setView('browser')
  }, [hasProjects, view])

  const glass = glassEnabled(settings)
  let content
  switch (project || view === 'settings' ? view : 'welcome') {
    case 'compare':
      content = <CompareView />
      break
    case 'terminal':
      content = null
      break
    case 'sync':
      content = <SyncQueueView />
      break
    case 'host':
      content = <HostForm />
      break
    case 'settings':
      content = <SettingsView />
      break
    case 'welcome':
      content = <WelcomeView />
      break
    default:
      content = <BrowserView />
  }

  return (
    <div className={`app-root ${glass ? '' : 'ad-reduce-transparency'} ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <HostSidebar />
      <div className="main-col">
        <ErrorBoundary resetKey={view}>
        <Suspense fallback={null}>
          {content}
          {/* Terminals stay mounted so sessions keep their scrollback. */}
          <div style={{ display: view === 'terminal' && project ? 'contents' : 'none' }}>
            <TerminalView visible={view === 'terminal'} />
          </div>
        </Suspense>
        </ErrorBoundary>
      </div>
      <CommandPalette />
      <ProjectDialog />
      <ConfirmDialog />
      <InputDialog />
      <PromptDialogs secretsAvailable={secretsAvailable} />
      <Toasts />
    </div>
  )
}
