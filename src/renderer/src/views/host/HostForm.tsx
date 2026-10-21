import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Chip, Icon, MainPanel, SectionLabel, SettingRow, SettingsGroup, StatusDot, Toggle } from '@/ds'
import type { AuthMethod, Host, Protocol, TestResult } from '@shared/types'
import { id } from '@shared/ids'
import { useApp, useActiveProject } from '../../stores/app'
import { useUi, toast } from '../../stores/ui'
import { invoke, errorText } from '../../lib/ipc'
import { connectHost } from '../../lib/actions'
import { Header, ProjectSwitch, Sep } from '../../shell/HeaderParts'

const DEFAULT_EXCLUDES = ['.env', '.git', 'node_modules', 'vendor', 'storage/logs', '.DS_Store']

function blankHost(projectId: string, localRoot: string): Host {
  return {
    id: id('h'),
    projectId,
    name: '',
    protocol: 'sftp',
    host: '',
    port: 22,
    username: '',
    auth: { method: 'key', keyPath: '~/.ssh/id_ed25519' },
    ftp: { mode: 'passive', implicitTls: false },
    mappings: [{ local: localRoot, remote: '' }],
    excluded: DEFAULT_EXCLUDES,
    behavior: { uploadOnSave: false, compareBeforeOverwrite: true, preservePermissions: true }
  }
}

const PROTOCOL_DESC: Record<Protocol, string> = {
  sftp: 'SFTP runs over SSH and enables the terminal',
  ftp: 'Unencrypted · use only on trusted networks',
  ftps: 'FTP over TLS · no SSH terminal for this host'
}

const DEFAULT_PORT = (p: Protocol, implicit: boolean) => (p === 'sftp' ? 22 : p === 'ftps' && implicit ? 990 : 21)

export function HostForm() {
  const editId = useUi((s) => s.editHostId)
  const hosts = useApp((s) => s.hosts)
  const project = useActiveProject()
  const existing = hosts.find((h) => h.id === editId)
  // Remount the form whenever a different host is edited.
  return project ? <Form key={editId ?? 'new'} existing={existing} projectId={project.id} localRoot={project.localRoot} /> : null
}

function Form({ existing, projectId, localRoot }: { existing?: Host; projectId: string; localRoot: string }) {
  const secretsAvailable = useApp((s) => s.secretsAvailable)
  const [h, setH] = useState<Host>(() => (existing ? structuredClone(existing) : blankHost(projectId, localRoot)))
  const [secret, setSecret] = useState('')
  const [saveSecret, setSaveSecret] = useState(existing?.auth.hasSecret ?? true)
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'done'; result?: TestResult }>({ state: 'idle' })
  const [saving, setSaving] = useState(false)
  const [newPattern, setNewPattern] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const setView = useUi((s) => s.setView)

  const isFtp = h.protocol !== 'sftp'
  const auth: AuthMethod = isFtp ? 'password' : h.auth.method
  const patch = (p: Partial<Host>) => {
    setH((cur) => ({ ...cur, ...p }))
    setTest({ state: 'idle' })
  }

  useEffect(() => {
    if (isFtp && h.auth.method !== 'password') setH((c) => ({ ...c, auth: { ...c.auth, method: 'password' } }))
  }, [isFtp, h.auth.method])

  const errors = useMemo(() => {
    const e: Record<string, string> = {}
    if (!h.host.trim()) e.host = 'Enter the server address'
    if (!h.username.trim()) e.username = 'Enter a username'
    if (!(h.port > 0 && h.port < 65536)) e.port = 'Port 1–65535'
    if (h.mappings.some((m) => m.remote && !m.remote.startsWith('/'))) e.mappings = 'Deployment paths start with /'
    return e
  }, [h])

  const secretPayload = () => (auth === 'agent' ? null : secret ? { value: secret, save: saveSecret } : existing && !saveSecret ? { value: '', save: false } : undefined)

  const runTest = async () => {
    setTouched(true)
    if (Object.keys(errors).length) return
    setTest({ state: 'running' })
    const result = await invoke('hosts:test', { host: { ...h, auth: { ...h.auth, method: auth } }, secret: secret ? { value: secret, save: false } : undefined }).catch((e) => ({ ok: false, error: errorText(e) }))
    setTest({ state: 'done', result })
  }

  const save = async () => {
    setTouched(true)
    if (Object.keys(errors).length) return
    setSaving(true)
    try {
      await invoke('hosts:save', { host: { ...h, name: h.name.trim() || h.host.trim(), auth: { ...h.auth, method: auth } }, secret: secretPayload() })
      await useApp.getState().updateSettings({ activeHostId: h.id })
      toast(existing ? `${h.name || h.host} saved` : `${h.name || h.host} added`, 'success')
      setView('browser')
      void connectHost(h.id)
    } catch (e) {
      toast(errorText(e), 'danger')
    } finally {
      setSaving(false)
    }
  }

  const testView =
    test.state === 'running'
      ? { status: 'neutral' as const, label: 'Testing', text: `Connecting to ${h.host}…` }
      : test.state === 'done' && test.result?.ok
        ? { status: 'success' as const, label: 'Test passed', text: `Connected${test.result.serverVersion ? ` · ${test.result.serverVersion}` : ''}${test.result.latencyMs != null ? ` · ${test.result.latencyMs} ms` : ''}` }
        : test.state === 'done'
          ? { status: 'danger' as const, label: 'Test failed', text: test.result?.error ?? 'Connection failed' }
          : { status: 'neutral' as const, label: 'Not tested', text: 'Not tested yet' }

  const fieldErr = (k: string) => (touched && errors[k] ? ' field-invalid' : '')

  return (
    <>
      <Header>
        <ProjectSwitch />
        <Sep />
        <span style={{ color: 'var(--ink)', padding: '0 8px' }}>{existing ? existing.name : 'New host'}</span>
      </Header>

      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex' }}>
        <MainPanel variant="settings" title={existing ? 'Edit Remote Host' : 'Add Remote Host'}>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SectionLabel>Connection</SectionLabel>
            <SettingsGroup label="Connection">
              <SettingRow title="Name" description="Shown in the sidebar and on tabs">
                <input className="field" type="text" value={h.name} placeholder={h.host || 'prod-web-01'} aria-label="Host name" style={{ width: 260 }} onChange={(e) => patch({ name: e.target.value })} />
              </SettingRow>
              <SettingRow title="Protocol" description={PROTOCOL_DESC[h.protocol]}>
                <div role="radiogroup" aria-label="Protocol" style={{ display: 'flex', gap: 8 }}>
                  {(['sftp', 'ftp', 'ftps'] as const).map((p) => (
                    <Chip
                      key={p}
                      selected={h.protocol === p}
                      onClick={() => {
                        const wasDefault = h.port === DEFAULT_PORT(h.protocol, !!h.ftp?.implicitTls)
                        patch({ protocol: p, port: wasDefault ? DEFAULT_PORT(p, !!h.ftp?.implicitTls) : h.port })
                      }}
                    >
                      {p.toUpperCase()}
                    </Chip>
                  ))}
                </div>
              </SettingRow>
              {isFtp ? (
                <SettingRow title="Transfer mode" description="Passive works behind most firewalls and NAT · active mode is not supported">
                  <div role="radiogroup" aria-label="Transfer mode" style={{ display: 'flex', gap: 8 }}>
                    <Chip selected>Passive</Chip>
                    <Chip disabled title="Not supported in this version">
                      Active
                    </Chip>
                  </div>
                </SettingRow>
              ) : null}
              {h.protocol === 'ftps' ? (
                <SettingRow title="Implicit TLS" description="Legacy FTPS on port 990; leave off for explicit TLS (AUTH TLS)">
                  <Toggle
                    label="Implicit TLS"
                    checked={!!h.ftp?.implicitTls}
                    onChange={(on) => patch({ ftp: { mode: 'passive', implicitTls: on }, port: h.port === DEFAULT_PORT('ftps', !on) ? DEFAULT_PORT('ftps', on) : h.port })}
                  />
                </SettingRow>
              ) : null}
              <SettingRow title="Host and port" description={touched && (errors.host || errors.port) ? (errors.host ?? errors.port) : 'IP address or domain of the server'}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className={'field field-mono' + fieldErr('host')} type="text" value={h.host} placeholder="203.0.113.24" aria-label="Host" style={{ width: 188 }} onChange={(e) => patch({ host: e.target.value.trim() })} />
                  <input className={'field field-mono' + fieldErr('port')} type="text" inputMode="numeric" value={String(h.port || '')} aria-label="Port" style={{ width: 64 }} onChange={(e) => patch({ port: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
                </div>
              </SettingRow>
              <SettingRow title="Username" description={touched && errors.username ? errors.username : 'Account used for file transfer and SSH'}>
                <input className={'field field-mono' + fieldErr('username')} type="text" value={h.username} placeholder="deploy" aria-label="Username" style={{ width: 260 }} onChange={(e) => patch({ username: e.target.value })} />
              </SettingRow>
            </SettingsGroup>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SectionLabel>Authentication</SectionLabel>
            <SettingsGroup label="Authentication">
              <SettingRow title="Method" description={isFtp ? 'FTP servers sign in with a password' : 'Key pair is recommended for production hosts'}>
                <div role="radiogroup" aria-label="Authentication method" style={{ display: 'flex', gap: 8 }}>
                  {(isFtp ? (['password'] as const) : (['key', 'password', 'agent'] as const)).map((m) => (
                    <Chip key={m} selected={auth === m} onClick={() => patch({ auth: { ...h.auth, method: m } })}>
                      {m === 'key' ? 'Key pair' : m === 'agent' ? 'SSH agent' : 'Password'}
                    </Chip>
                  ))}
                </div>
              </SettingRow>
              {auth === 'key' ? (
                <SettingRow title="Private key" description="Ed25519 or RSA key file on this computer">
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="field field-mono" type="text" value={h.auth.keyPath ?? ''} aria-label="Private key path" style={{ width: 188 }} onChange={(e) => patch({ auth: { ...h.auth, keyPath: e.target.value } })} />
                    <Button
                      variant="outline"
                      onClick={async () => {
                        const p = await invoke('app:pickPath', { kind: 'file', defaultPath: '~/.ssh', title: 'Choose a private key' })
                        if (p) patch({ auth: { ...h.auth, keyPath: p } })
                      }}
                    >
                      Browse
                    </Button>
                  </div>
                </SettingRow>
              ) : null}
              {auth !== 'agent' ? (
                <SettingRow
                  title={auth === 'key' ? 'Passphrase' : 'Password'}
                  description={existing?.auth.hasSecret && !secret ? 'Saved in the keychain · type to replace it' : auth === 'key' ? 'Only if the key is encrypted · sent nowhere' : 'Sent only to this host over the connection'}
                >
                  <input className="field" type="password" value={secret} placeholder={existing?.auth.hasSecret ? '••••••••' : ''} aria-label={auth === 'key' ? 'Key passphrase' : 'Password'} style={{ width: 260 }} onChange={(e) => (setSecret(e.target.value), setTest({ state: 'idle' }))} />
                </SettingRow>
              ) : (
                <SettingRow title="SSH agent" description="Keys loaded in ssh-agent · the server picks the one it accepts">
                  <Badge tone="success">Uses SSH_AUTH_SOCK</Badge>
                </SettingRow>
              )}
              {auth !== 'agent' ? (
                <SettingRow title={auth === 'key' ? 'Save passphrase in keychain' : 'Save password in keychain'} description={secretsAvailable ? 'Stored by the operating system, never in project files' : 'The system keychain is not available: you will be asked each session'}>
                  <Toggle label="Save in keychain" checked={saveSecret && secretsAvailable} disabled={!secretsAvailable} onChange={setSaveSecret} />
                </SettingRow>
              ) : null}
            </SettingsGroup>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SectionLabel>Mappings</SectionLabel>
            <div style={{ background: 'var(--bg-card)', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 16px minmax(0, 1fr) 28px', gap: 8, padding: '10px 16px 6px', fontSize: 12, lineHeight: '16px', color: 'var(--ink-muted)' }}>
                <span>Local path</span>
                <span />
                <span>Deployment path</span>
                <span />
              </div>
              {h.mappings.map((m, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 16px minmax(0, 1fr) 28px', gap: 8, alignItems: 'center', padding: '6px 16px', borderTop: '1px solid var(--line)' }}>
                  <span className="row" style={{ gap: 4 }}>
                    <input className="field field-mono" type="text" value={m.local} aria-label="Local path" style={{ width: '100%' }} onChange={(e) => patch({ mappings: h.mappings.map((x, j) => (j === i ? { ...x, local: e.target.value } : x)) })} />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="folder-open"
                      iconOnly
                      onClick={async () => {
                        const p = await invoke('app:pickPath', { kind: 'folder', defaultPath: m.local || localRoot })
                        if (p) patch({ mappings: h.mappings.map((x, j) => (j === i ? { ...x, local: p } : x)) })
                      }}
                    >
                      Choose local folder
                    </Button>
                  </span>
                  <Icon name="chevron-right" style={{ color: 'var(--ink-subtle)' }} />
                  <input className={'field field-mono' + (touched && m.remote && !m.remote.startsWith('/') ? ' field-invalid' : '')} type="text" value={m.remote} placeholder="/var/www/app" aria-label="Deployment path" style={{ width: '100%' }} onChange={(e) => patch({ mappings: h.mappings.map((x, j) => (j === i ? { ...x, remote: e.target.value } : x)) })} />
                  <Button variant="ghost" size="sm" icon="x" iconOnly onClick={() => patch({ mappings: h.mappings.filter((_, j) => j !== i) })}>
                    Remove mapping
                  </Button>
                </div>
              ))}
              {touched && errors.mappings ? <div style={{ padding: '0 16px 6px', fontSize: 12, color: 'var(--danger)' }}>{errors.mappings}</div> : null}
              <div style={{ padding: '8px 16px 12px', borderTop: '1px solid var(--line)' }}>
                <Button variant="ghost" size="sm" icon="plus" onClick={() => patch({ mappings: [...h.mappings, { local: h.mappings.length ? '' : localRoot, remote: '' }] })}>
                  Add mapping
                </Button>
              </div>
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SectionLabel>Excluded paths</SectionLabel>
            <div style={{ background: 'var(--bg-card)', borderRadius: 10, padding: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {h.excluded.map((p) => (
                <Chip key={p} shape="square" trailingIcon="x" trailingLabel={`Remove ${p}`} onTrailingClick={() => patch({ excluded: h.excluded.filter((x) => x !== p) })}>
                  {p}
                </Chip>
              ))}
              {newPattern === null ? (
                <Chip shape="square" icon="plus" onClick={() => setNewPattern('')}>
                  Add pattern
                </Chip>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const v = newPattern.trim()
                    if (v && !h.excluded.includes(v)) patch({ excluded: [...h.excluded, v] })
                    setNewPattern(null)
                  }}
                >
                  <input className="field field-mono" autoFocus value={newPattern} placeholder="storage/*.log" aria-label="Exclude pattern" style={{ width: 180 }} onChange={(e) => setNewPattern(e.target.value)} onBlur={(e) => e.currentTarget.form?.requestSubmit()} onKeyDown={(e) => e.key === 'Escape' && setNewPattern(null)} />
                </form>
              )}
              <span style={{ flexBasis: '100%', fontSize: 12, color: 'var(--ink-subtle)' }}>Patterns like .gitignore: * matches within a folder, ** across folders, a trailing / matches folders only</span>
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SectionLabel>Behavior</SectionLabel>
            <SettingsGroup label="Behavior">
              <SettingRow title="Upload on save" description="Send changed files to this host as soon as they are saved">
                <Toggle label="Upload on save" checked={h.behavior.uploadOnSave} onChange={(on) => patch({ behavior: { ...h.behavior, uploadOnSave: on } })} />
              </SettingRow>
              <SettingRow title="Compare before overwriting" description="Open a diff when the remote file changed after your last sync">
                <Toggle label="Compare before overwriting" checked={h.behavior.compareBeforeOverwrite} onChange={(on) => patch({ behavior: { ...h.behavior, compareBeforeOverwrite: on } })} />
              </SettingRow>
              <SettingRow title="Preserve permissions" description="Keep the file mode when uploading and downloading">
                <Toggle label="Preserve permissions" checked={h.behavior.preservePermissions} onChange={(on) => patch({ behavior: { ...h.behavior, preservePermissions: on } })} />
              </SettingRow>
              <SettingRow title="Parallel transfers" description={isFtp ? 'Each FTP transfer opens its own connection' : 'Files transferred at the same time over one SSH connection'}>
                <div className="row" role="radiogroup" aria-label="Parallel transfers">
                  {[1, 2, 3, 4, 6].map((n) => (
                    <Chip key={n} selected={(h.concurrency ?? (isFtp ? 2 : 3)) === n} onClick={() => patch({ concurrency: n })}>
                      {n}
                    </Chip>
                  ))}
                </div>
              </SettingRow>
            </SettingsGroup>
          </section>
        </MainPanel>
      </div>

      <footer style={{ height: 60, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '0 24px', borderTop: '1px solid var(--line)' }}>
        <span role="status" className="ell" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: test.state === 'done' && !test.result?.ok ? 'var(--danger)' : 'var(--ink-muted)', minWidth: 0 }}>
          <StatusDot status={testView.status} label={testView.label} />
          <span className="ell">{testView.text}</span>
        </span>
        <span className="spacer" />
        <Button variant="ghost" onClick={() => setView('browser')}>
          Cancel
        </Button>
        <Button variant="outline" icon={test.state === 'running' ? 'spinner' : 'check'} disabled={test.state === 'running'} onClick={() => void runTest()}>
          Test Connection
        </Button>
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          {existing ? 'Save Host' : 'Add Host'}
        </Button>
      </footer>
    </>
  )
}
