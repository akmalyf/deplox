import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Icon } from '@/ds'
import type { FsEntry, HostSaveRequest } from '@shared/types'
import { id } from '@shared/ids'
import { invoke, errorText } from '../../lib/ipc'
import { Modal } from '../../shell/dialogs/Modal'

const parentOf = (p: string) => (p === '/' ? '/' : p.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/')

/** Walks the server's folders over a throwaway connection made from the (possibly unsaved) host form. */
export function RemoteFolderPicker({ request, start, onPick, onCancel }: { request: HostSaveRequest; start: string; onPick: (path: string) => void; onCancel: () => void }) {
  const session = useMemo(() => id('b'), [])
  const [path, setPath] = useState('')
  const [draft, setDraft] = useState(start)
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  // The form values are captured once: the connection behind this session is made from them.
  const req = useRef(request)

  const go = async (to: string) => {
    const n = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const r = await invoke('hosts:browse', { ...req.current, session, path: to })
      if (n !== seq.current) return
      setPath(r.path)
      setDraft(r.path)
      setEntries(r.entries)
    } catch (e) {
      if (n !== seq.current) return
      setError(errorText(e))
      setDraft(to || path)
    } finally {
      if (n === seq.current) setLoading(false)
    }
  }

  useEffect(() => {
    void go(start.startsWith('/') ? start : '')
    return () => void invoke('hosts:browseEnd', session).catch(() => {})
    // Runs once per picker: `go` and `start` are fixed for its lifetime.
  }, [session])

  const { host } = req.current
  return createPortal(
    <Modal label="Choose deployment path" onCancel={onCancel} width={560} className="scrim-under">
      <h2>Choose deployment path</h2>
      <p className="ell">
        {host.username ? `${host.username}@` : ''}
        {host.host}
        {host.port ? `:${host.port}` : ''}
      </p>
      <form
        className="row"
        style={{ gap: 4 }}
        onSubmit={(e) => {
          e.preventDefault()
          void go(draft.trim())
        }}
      >
        <Button variant="ghost" size="sm" icon="arrow-left" iconOnly disabled={loading || !path || path === '/'} onClick={() => void go(parentOf(path))}>
          Parent folder
        </Button>
        <Button variant="ghost" size="sm" icon="home" iconOnly disabled={loading} onClick={() => void go('')}>
          Login folder
        </Button>
        <input className="field field-mono" style={{ flex: '1 1 auto' }} value={draft} aria-label="Remote path" spellCheck={false} onChange={(e) => setDraft(e.target.value)} />
      </form>
      <div className="rpick-list" role="listbox" aria-label="Folders" aria-busy={loading}>
        {error ? (
          <div className="rpick-note" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        ) : loading && !entries.length ? (
          <div className="rpick-note">
            <Icon name="spinner" /> Connecting…
          </div>
        ) : !entries.length ? (
          <div className="rpick-note">No folders here</div>
        ) : (
          entries.map((e) => (
            <button key={e.path} type="button" role="option" aria-selected="false" className="rpick-row" disabled={loading} onClick={() => void go(e.path)}>
              <Icon name="folder" style={{ color: 'var(--ink-subtle)', flex: '0 0 auto' }} />
              <span className="ell" style={{ flex: '1 1 auto' }}>
                {e.name}
              </span>
              {e.type === 'symlink' ? <span style={{ fontSize: 11, color: 'var(--ink-subtle)' }}>link</span> : null}
              <Icon name="chevron-right" style={{ color: 'var(--ink-subtle)', flex: '0 0 auto' }} />
            </button>
          ))
        )}
      </div>
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" disabled={loading || !!error || !path} onClick={() => onPick(path)}>
          Use This Folder
        </Button>
      </div>
    </Modal>,
    document.body
  )
}
