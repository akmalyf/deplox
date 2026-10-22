import { useState } from 'react'
import { Button, Chip, MainPanel, SectionLabel, SettingRow, SettingsGroup, Toggle } from '@/ds'
import { useApp } from '../stores/app'
import { useUi, toast } from '../stores/ui'
import { invoke, isMac } from '../lib/ipc'
import { Header } from '../shell/HeaderParts'

export function SettingsView() {
  const settings = useApp((s) => s.settings)
  const snippets = useApp((s) => s.snippets)
  const update = useApp((s) => s.updateSettings)
  const secretsAvailable = useApp((s) => s.secretsAvailable)
  const setView = useUi((s) => s.setView)
  const hasProjects = useApp((s) => s.projects.length > 0)
  const [shell, setShell] = useState(settings.shell ?? '')

  return (
    <>
      <Header>
        <span style={{ color: 'var(--ink)', fontWeight: 500, padding: '0 8px' }}>Settings</span>
        <span className="spacer" />
        {hasProjects ? (
          <Button variant="ghost" size="sm" icon="arrow-left" onClick={() => setView('browser')}>
            Back
          </Button>
        ) : null}
      </Header>
      <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex' }}>
        <MainPanel variant="settings" title="Settings">
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SectionLabel>Appearance</SectionLabel>
            <SettingsGroup label="Appearance">
              <SettingRow title="Theme" description="Choose between light, dark, or the system setting">
                <div className="row" role="radiogroup" aria-label="Theme">
                  {(['dark', 'light', 'system'] as const).map((t) => (
                    <Chip key={t} selected={settings.theme === t} onClick={() => void update({ theme: t })}>
                      {t[0].toUpperCase() + t.slice(1)}
                    </Chip>
                  ))}
                </div>
              </SettingRow>
              {isMac ? (
                <SettingRow title="Reduce transparency" description="Use a solid sidebar instead of the translucent one">
                  <Toggle label="Reduce transparency" checked={settings.reduceTransparency} onChange={(on) => void update({ reduceTransparency: on })} />
                </SettingRow>
              ) : null}
            </SettingsGroup>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SectionLabel>Transfers</SectionLabel>
            <SettingsGroup label="Transfers">
              <SettingRow title="Parallel SFTP transfers" description="Default for hosts that don't set their own">
                <div className="row" role="radiogroup" aria-label="Parallel transfers">
                  {[1, 2, 3, 4, 6, 8].map((n) => (
                    <Chip key={n} selected={settings.defaultConcurrency === n} onClick={() => void update({ defaultConcurrency: n })}>
                      {n}
                    </Chip>
                  ))}
                </div>
              </SettingRow>
              <SettingRow title="Keychain" description={secretsAvailable ? 'Passwords and passphrases are encrypted by the operating system' : 'Not available: secrets are kept for this session only'}>
                <span className="muted">{secretsAvailable ? 'Available' : 'Unavailable'}</span>
              </SettingRow>
            </SettingsGroup>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SectionLabel>Terminal</SectionLabel>
            <SettingsGroup label="Terminal">
              <SettingRow title="Local shell" description="Leave empty to use your login shell">
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void update({ shell: shell.trim() || undefined }).then(() => toast('Shell saved'))
                  }}
                >
                  <input className="field field-mono" value={shell} placeholder={isMac ? '/bin/zsh' : 'powershell.exe'} aria-label="Local shell" style={{ width: 200 }} onChange={(e) => setShell(e.target.value)} />
                  <Button type="submit" variant="outline" disabled={(settings.shell ?? '') === shell}>
                    Save
                  </Button>
                </form>
              </SettingRow>
            </SettingsGroup>
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '10px 16px 6px', fontSize: 12, color: 'var(--ink-muted)' }}>Snippets</div>
              {snippets.map((s) => (
                <div key={s.id} className="row" style={{ padding: '6px 8px 6px 16px', borderTop: '1px solid var(--line)' }}>
                  <span className="mono ell" style={{ flex: '1 1 auto' }}>
                    {s.command}
                  </span>
                  <Button variant="ghost" size="sm" icon="x" iconOnly onClick={() => void invoke('snippets:save', snippets.filter((x) => x.id !== s.id))}>
                    Remove snippet
                  </Button>
                </div>
              ))}
              <div style={{ padding: '8px 16px 12px', borderTop: '1px solid var(--line)' }}>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="plus"
                  onClick={() =>
                    useUi.getState().askInput({
                      title: 'Add snippet',
                      label: 'Command',
                      mono: true,
                      confirm: 'Add',
                      validate: (v) => (!v.trim() ? 'Enter a command' : null),
                      run: (v) => void invoke('snippets:save', [...snippets, { id: `sn_${Date.now()}`, label: v.trim(), command: v.trim() }])
                    })
                  }
                >
                  Add snippet
                </Button>
              </div>
            </div>
          </section>
        </MainPanel>
      </div>
    </>
  )
}
