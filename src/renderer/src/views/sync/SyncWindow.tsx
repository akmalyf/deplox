import { useEffect } from 'react'
import type { SyncWindowRequest } from '@shared/types'
import { useApp } from '../../stores/app'
import { useSyncDialog } from '../../stores/syncDialog'
import { PromptDialogs } from '../../shell/dialogs/PromptDialogs'
import { ConfirmDialog, Toasts } from '../../shell/dialogs/CommonDialogs'
import { SyncPanel } from './SyncPanel'

const close = () => window.close()

/** Root of a Sync window: the compare panel plus the prompts a connection may raise. */
export function SyncWindow({ req }: { req: SyncWindowRequest }) {
  const secretsAvailable = useApp((s) => s.secretsAvailable)
  useEffect(() => {
    useSyncDialog.getState().openSync(req.hostId, req.scope)
  }, [req])
  return (
    <div className={window.deplox.platform === 'darwin' ? 'sync-window sync-window-mac' : 'sync-window'}>
      <SyncPanel onClose={close} />
      <ConfirmDialog />
      <PromptDialogs secretsAvailable={secretsAvailable} />
      <Toasts />
    </div>
  )
}
