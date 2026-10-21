import { useState } from 'react'
import { Button } from '@/ds'
import { useUi } from '../../stores/ui'
import { Modal } from './Modal'

export function ConfirmDialog() {
  const c = useUi((s) => s.confirm)
  const close = () => useUi.getState().askConfirm(null)
  const [busy, setBusy] = useState(false)
  if (!c) return null
  return (
    <Modal label={c.title} onCancel={close} role="alertdialog">
      <h2>{c.title}</h2>
      {c.description ? <p>{c.description}</p> : null}
      {c.detail ? (
        <div className="code-box" style={{ whiteSpace: 'pre-wrap' }}>
          {c.detail}
        </div>
      ) : null}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={close} data-autofocus={c.danger ? true : undefined}>
          Cancel
        </Button>
        {c.danger ? (
          <button
            type="button"
            className="btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await c.run()
              } finally {
                setBusy(false)
                close()
              }
            }}
          >
            {c.confirm}
          </button>
        ) : (
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await c.run()
              } finally {
                setBusy(false)
                close()
              }
            }}
          >
            {c.confirm}
          </Button>
        )}
      </div>
    </Modal>
  )
}

export function InputDialog() {
  const c = useUi((s) => s.input)
  if (!c) return null
  return <InputDialogInner key={c.title + (c.value ?? '')} />
}

function InputDialogInner() {
  const c = useUi((s) => s.input)!
  const [value, setValue] = useState(c.value ?? '')
  const [touched, setTouched] = useState(false)
  const close = () => useUi.getState().askInput(null)
  const error = c.validate?.(value) ?? null
  return (
    <Modal label={c.title} onCancel={close}>
      <h2>{c.title}</h2>
      {c.description ? (
        <p className="mono ell" title={c.description}>
          {c.description}
        </p>
      ) : null}
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault()
          setTouched(true)
          if (error) return
          close()
          void c.run(value)
        }}
      >
        <input
          className={`field${c.mono ? ' field-mono' : ''}${touched && error ? ' field-invalid' : ''}`}
          aria-label={c.label}
          placeholder={c.label}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => {
            const dot = e.target.value.lastIndexOf('.')
            e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length)
          }}
          autoFocus
        />
        {touched && error ? <span style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</span> : null}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            {c.confirm}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)
  if (!toasts.length) return null
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 150 }}>
      {toasts.map((t, i) => (
        <div key={t.id} role="status" className={t.tone === 'danger' ? 'toast toast-danger' : 'toast'} style={{ bottom: 56 + (toasts.length - 1 - i) * 48, pointerEvents: 'auto' }}>
          <span>{t.text}</span>
          {t.action ? (
            <button
              type="button"
              className="toast-btn"
              onClick={() => {
                t.action!.run()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button type="button" className="toast-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
