import { Button, EmptyState, MainPanel } from '@/ds'
import { useUi } from '../stores/ui'
import { Header } from '../shell/HeaderParts'

export function WelcomeView() {
  const open = useUi((s) => s.openProjectDialog)
  return (
    <>
      <Header>
        <span style={{ color: 'var(--ink)', fontWeight: 500, padding: '0 8px' }}>Deplox</span>
      </Header>
      <MainPanel variant="center">
        <EmptyState
          align="center"
          title="Deploy a local folder to your servers"
          description="Create a project for a local folder, add the SFTP or FTP hosts it deploys to, then browse, compare and sync files side by side"
          actions={
            <Button variant="primary" icon="folder-plus" onClick={() => open({ mode: 'new' })}>
              New Project
            </Button>
          }
          note="Passwords and key passphrases are stored in the system keychain"
        />
      </MainPanel>
    </>
  )
}
