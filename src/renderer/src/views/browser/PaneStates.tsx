import { useEffect, useState } from 'react'
import { Button, EmptyState, Icon, StatusDot } from '@/ds'
import type { Host, HostConn } from '@shared/types'
import { connectHost } from '../../lib/actions'
import { useUi } from '../../stores/ui'
import { invoke } from '../../lib/ipc'

const SKELETON = [
  { indent: 0, w: 30 }, { indent: 16, w: 26 }, { indent: 32, w: 44 }, { indent: 32, w: 38 },
  { indent: 32, w: 52 }, { indent: 16, w: 22 }, { indent: 0, w: 28 }, { indent: 0, w: 34 }
]

export function LoadingSkeleton({ label, onCancel }: { label: string; onCancel?: () => void }) {
  const [t0] = useState(() => Date.now())
  const [now, setNow] = useState(t0)
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(i)
  }, [])
  const slow = now - t0 > 2000
  return (
    <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div aria-hidden="true" style={{ flex: '1 1 auto', minHeight: 0, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {SKELETON.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, paddingLeft: s.indent }}>
            <span className="sk" style={{ width: 14, height: 14 }} />
            <span className="sk" style={{ width: `${s.w}%` }} />
            <span className="spacer" />
            <span className="sk" style={{ width: 40 }} />
          </div>
        ))}
      </div>
      <div role="status" style={{ padding: '8px 16px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="spinner" className="spin" style={{ color: 'var(--ink-subtle)' }} />
        <span style={{ fontSize: 11, lineHeight: '14px', color: 'var(--ink-subtle)' }}>
          {label}
          {slow ? ` · slow link · ${((now - t0) / 1000).toFixed(1)} s so far` : ''}
        </span>
        <span className="spacer" />
        {onCancel ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function SignInFailed({ host, conn }: { host: Host; conn: HostConn }) {
  const editHost = useUi((s) => s.editHost)
  return (
    <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 32px', gap: 16, textAlign: 'center' }}>
      <span className="icon-disc" style={{ color: 'var(--warning)' }}>
        <Icon name="lock" />
      </span>
      <EmptyState align="center" title={`Can't sign in to ${host.name}`} description={conn.error ?? 'The server rejected the credentials'} />
      <div className="row">
        <Button variant="primary" onClick={() => void connectHost(host.id)}>
          {host.auth.method === 'key' ? 'Enter passphrase' : host.auth.method === 'agent' ? 'Try again' : 'Enter password'}
        </Button>
        <Button variant="ghost" onClick={() => editHost(host.id)}>
          Edit host
        </Button>
      </div>
    </div>
  )
}

export function Disconnected({ host, conn }: { host: Host; conn: HostConn }) {
  const editHost = useUi((s) => s.editHost)
  const failed = conn.state === 'error'
  return (
    <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 32px', gap: 16, textAlign: 'center' }}>
      <span className="icon-disc" style={{ color: failed ? 'var(--danger)' : 'var(--ink-muted)' }}>
        <Icon name="cloud" />
      </span>
      <EmptyState align="center" title={failed ? `Can't reach ${host.name}` : `${host.name} is not connected`} description={conn.error ?? `${host.protocol.toUpperCase()} · ${host.username}@${host.host}:${host.port}`} />
      <div className="row">
        <Button variant="primary" onClick={() => void connectHost(host.id)}>
          {failed ? 'Try again' : 'Connect'}
        </Button>
        <Button variant="ghost" onClick={() => editHost(host.id)}>
          Edit host
        </Button>
      </div>
    </div>
  )
}

export function ReconnectBanner({ host, conn }: { host: Host; conn: HostConn }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(i)
  }, [])
  const secs = conn.nextRetryAt ? Math.max(0, Math.ceil((conn.nextRetryAt - now) / 1000)) : 0
  return (
    <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 16px', background: 'var(--bg-raised)', borderBottom: '1px solid var(--line-strong)' }}>
      <div className="row">
        <StatusDot status="warning" label="Warning" />
        <span style={{ fontWeight: 500 }}>Connection to {host.name} lost</span>
      </div>
      <span className="muted">
        {secs > 0 ? `Reconnecting in ${secs} s · attempt ${conn.attempt} of ${conn.maxAttempts}.` : `Reconnecting · attempt ${conn.attempt} of ${conn.maxAttempts}.`} Transfers are paused and resume on their own.
      </span>
      <div className="row">
        <Button size="sm" onClick={() => void connectHost(host.id)}>
          Reconnect now
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void invoke('hosts:disconnect', host.id)}>
          Work offline
        </Button>
      </div>
    </div>
  )
}

export function NoMapping({ host }: { host: Host }) {
  const editHost = useUi((s) => s.editHost)
  return (
    <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <EmptyState
        align="center"
        title="No deployment path"
        description={`Add a mapping so local files know where they go on ${host.name}`}
        actions={
          <Button variant="primary" onClick={() => editHost(host.id)}>
            Add mapping
          </Button>
        }
      />
    </div>
  )
}
