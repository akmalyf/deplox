import { useState } from 'react'
import { Button } from '@/ds'
import type { Project } from '@shared/types'
import { PROJECT_COLORS, initials } from '@shared/format'
import { id } from '@shared/ids'
import { useApp } from '../../stores/app'
import { useUi, toast } from '../../stores/ui'
import { invoke, errorText } from '../../lib/ipc'
import { Modal } from './Modal'

export function ProjectDialog() {
  const d = useUi((s) => s.projectDialog)
  if (!d) return null
  return <Inner key={d.projectId ?? 'new'} />
}

function Inner() {
  const d = useUi((s) => s.projectDialog)!
  const projects = useApp((s) => s.projects)
  const existing = d.mode === 'edit' ? projects.find((p) => p.id === d.projectId) : undefined
  const [name, setName] = useState(existing?.name ?? '')
  const [root, setRoot] = useState(existing?.localRoot ?? '')
  const [color, setColor] = useState(existing?.color ?? PROJECT_COLORS[projects.length % PROJECT_COLORS.length])
  const close = () => useUi.getState().openProjectDialog(null)

  const save = async () => {
    if (!name.trim() || !root.trim()) return
    const p: Project = existing ? { ...existing, name: name.trim(), localRoot: root.trim(), color } : { id: id('p'), name: name.trim(), localRoot: root.trim(), color, createdAt: Date.now() }
    try {
      await invoke('projects:save', p)
      if (!existing) {
        const settings = await invoke('projects:open', p.id)
        useApp.setState({ settings })
        useUi.getState().editHost('new')
      }
      close()
    } catch (e) {
      toast(errorText(e), 'danger')
    }
  }

  const remove = () =>
    useUi.getState().askConfirm({
      title: `Delete project ${existing?.name}?`,
      description: 'Its hosts, saved passwords and queue are removed. Files on disk and on servers stay untouched.',
      confirm: 'Delete Project',
      danger: true,
      run: async () => {
        await invoke('projects:delete', existing!.id)
        close()
      }
    })

  return (
    <Modal label={existing ? 'Edit project' : 'New project'} onCancel={close} width={480}>
      <h2>{existing ? 'Edit project' : 'New project'}</h2>
      <p>A project groups the hosts you deploy one local folder to.</p>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="field-label">Name</span>
          <input
            className="field"
            value={name}
            placeholder="my-app"
            autoFocus
            onChange={(e) => {
              setName(e.target.value)
            }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="field-label">Local folder</span>
          <span className="row">
            <input className="field field-mono" style={{ flex: '1 1 auto' }} value={root} placeholder="~/Projects/my-app" onChange={(e) => setRoot(e.target.value)} />
            <Button
              variant="outline"
              onClick={async () => {
                const p = await invoke('app:pickPath', { kind: 'folder', defaultPath: root || undefined, title: 'Choose the project folder' })
                if (p) {
                  setRoot(p)
                  if (!name.trim()) setName(p.split(/[\\/]/).pop() ?? '')
                }
              }}
            >
              Browse
            </Button>
          </span>
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="field-label">Color</span>
          <div className="row" role="radiogroup" aria-label="Project color">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === color}
                aria-label={c}
                onClick={() => setColor(c)}
                className="proj-avatar"
                style={{ background: c, width: 28, height: 28, borderRadius: 6, border: 0, cursor: 'pointer', outline: c === color ? '2px solid var(--line-focus)' : undefined, outlineOffset: 2 }}
              >
                {c === color ? initials(name || 'P') : ''}
              </button>
            ))}
          </div>
        </div>
        <div className="dialog-actions">
          {existing ? (
            <button type="button" className="btn-danger" onClick={remove} style={{ marginRight: 'auto' }}>
              Delete
            </button>
          ) : null}
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!name.trim() || !root.trim()}>
            {existing ? 'Save' : 'Create Project'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
