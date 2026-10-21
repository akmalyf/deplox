import { useState } from 'react'
import { Button, Icon } from '@/ds'
import type { PromptAnswer, PromptRequest } from '@shared/types'
import { basename } from '@shared/paths'
import { useUi } from '../../stores/ui'
import { invoke } from '../../lib/ipc'
import { Modal } from './Modal'

function answer(requestId: string, a: PromptAnswer) {
  useUi.getState().dropPrompt(requestId)
  void invoke('prompt:answer', { requestId, answer: a })
}

function HostKey({ req }: { req: PromptRequest }) {
  const p = req.payload
  const [remember, setRemember] = useState(true)
  if (p.kind !== 'hostkey') return null
  const reject = () => answer(req.requestId, { kind: 'hostkey', trust: false, remember: false })
  return (
    <Modal label={`Verify ${p.hostName}`} onCancel={reject}>
      <div className="row">
        <Icon name="lock" style={{ color: 'var(--ink-muted)' }} />
        <h2>Verify {p.hostName} before connecting</h2>
      </div>
      <p>
        First connection to {p.host}:{p.port}. Check that this fingerprint matches the one from your server admin.
      </p>
      <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--line-strong)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--ink-muted)' }}>{p.keyType} key fingerprint</span>
        <span className="mono" style={{ overflowWrap: 'anywhere', userSelect: 'text' }}>
          {p.fingerprint}
        </span>
      </div>
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember this key for {p.hostName}
      </label>
      <div className="dialog-actions">
        <Button variant="ghost" onClick={reject}>
          Cancel
        </Button>
        <Button variant="primary" data-autofocus onClick={() => answer(req.requestId, { kind: 'hostkey', trust: true, remember })}>
          Trust and connect
        </Button>
      </div>
    </Modal>
  )
}

function Mismatch({ req }: { req: PromptRequest }) {
  const p = req.payload
  if (p.kind !== 'hostkey-mismatch') return null
  const cancel = () => answer(req.requestId, { kind: 'hostkey-mismatch', forget: false })
  return (
    <Modal label="Host key changed" onCancel={cancel} role="alertdialog">
      <div className="row">
        <Icon name="lock" style={{ color: 'var(--danger)' }} />
        <h2>The host key of {p.hostName} changed</h2>
      </div>
      <p>
        The server at {p.host}:{p.port} presents a different {p.keyType} key than the one you trusted. This happens after a server reinstall, or when someone intercepts the connection. Check with your server admin before continuing.
      </p>
      <div className="code-box" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="muted">Trusted</span>
        <span style={{ userSelect: 'text' }}>{p.expected}</span>
        <span className="muted">Presented now</span>
        <span style={{ userSelect: 'text' }}>{p.actual}</span>
      </div>
      <div className="dialog-actions">
        <Button variant="ghost" data-autofocus onClick={cancel}>
          Cancel
        </Button>
        <button type="button" className="btn-danger" onClick={() => answer(req.requestId, { kind: 'hostkey-mismatch', forget: true })}>
          Forget stored key
        </button>
      </div>
    </Modal>
  )
}

function Password({ req, secretsAvailable }: { req: PromptRequest; secretsAvailable: boolean }) {
  const p = req.payload
  const [value, setValue] = useState('')
  const [save, setSave] = useState(true)
  if (p.kind !== 'password') return null
  const cancel = () => answer(req.requestId, { kind: 'password', value: null, save: false })
  const what = p.secretKind === 'passphrase' ? 'key passphrase' : 'password'
  return (
    <Modal label={`Sign in to ${p.hostName}`} onCancel={cancel}>
      <h2>Sign in to {p.hostName}</h2>
      <p>{p.reason ?? `Enter the ${what} for ${p.hostName}.`}</p>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault()
          answer(req.requestId, { kind: 'password', value, save: save && p.canSave })
        }}
      >
        <input className="field" type="password" aria-label={what} placeholder={what[0].toUpperCase() + what.slice(1)} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        <label className="check" title={p.canSave ? undefined : 'The system keychain is not available'}>
          <input type="checkbox" checked={save && p.canSave} disabled={!p.canSave || !secretsAvailable} onChange={(e) => setSave(e.target.checked)} />
          Save {what} in keychain
        </label>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!value}>
            Sign in
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function Overwrite({ req }: { req: PromptRequest }) {
  const p = req.payload
  if (p.kind !== 'overwrite') return null
  const send = (choice: 'overwrite' | 'compare' | 'cancel') => answer(req.requestId, { kind: 'overwrite', choice })
  return (
    <Modal label="Remote file changed" onCancel={() => send('cancel')} role="alertdialog">
      <h2>Overwrite {basename(p.remotePath)} on {p.hostName}?</h2>
      <p>{p.reason}. Uploading replaces the server copy with your local file.</p>
      <div className="code-box">{p.remotePath}</div>
      <div className="dialog-actions">
        <Button variant="ghost" onClick={() => send('cancel')}>
          Cancel
        </Button>
        <Button variant="outline" icon="copy" data-autofocus onClick={() => send('compare')}>
          Compare first
        </Button>
        <button type="button" className="btn-danger" onClick={() => send('overwrite')}>
          Overwrite
        </button>
      </div>
    </Modal>
  )
}

export function PromptDialogs({ secretsAvailable }: { secretsAvailable: boolean }) {
  const prompts = useUi((s) => s.prompts)
  const req = prompts[0]
  if (!req) return null
  switch (req.payload.kind) {
    case 'hostkey':
      return <HostKey key={req.requestId} req={req} />
    case 'hostkey-mismatch':
      return <Mismatch key={req.requestId} req={req} />
    case 'password':
      return <Password key={req.requestId} req={req} secretsAvailable={secretsAvailable} />
    case 'overwrite':
      return <Overwrite key={req.requestId} req={req} />
  }
}
