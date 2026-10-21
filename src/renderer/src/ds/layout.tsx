import type { ReactNode } from 'react'
import { Avatar } from './primitives'
import { Button } from './Button'
import { Icon } from './Icon'
import { PageTitle } from './primitives'
import { cx } from './cx'

export interface SidebarProps {
  label?: string
  titlebar?: ReactNode
  footer?: ReactNode
  account?: { name: string; src?: string; onSettings?: () => void }
  children?: ReactNode
  className?: string
}

export function Sidebar({ label, titlebar, footer, account, children, className }: SidebarProps) {
  return (
    <aside className={cx('ad-sidebar', className)} aria-label={label || 'Sidebar'}>
      {titlebar ? <div className="ad-sidebar-titlebar">{titlebar}</div> : null}
      <div className="ad-sidebar-body">{children}</div>
      {footer != null || account ? (
        <div className="ad-sidebar-footer">
          {footer}
          {account ? (
            <div className="ad-sidebar-account">
              <Avatar name={account.name} src={account.src} />
              <span className="ad-sidebar-account-name">{account.name}</span>
              <Button variant="ghost" iconOnly icon="settings" size="sm" onClick={account.onSettings}>
                Settings
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  )
}

export interface MainPanelProps {
  variant?: 'page' | 'settings' | 'center'
  title?: ReactNode
  width?: number | string
  footer?: ReactNode
  children?: ReactNode
  className?: string
}

export function MainPanel({ variant = 'page', title, width, footer, children, className }: MainPanelProps) {
  return (
    <main className={cx('ad-main', variant === 'settings' && 'ad-main-settings', variant === 'center' && 'ad-main-center', className)}>
      <div className="ad-main-scroll">
        <div className="ad-main-column" style={width != null ? { maxWidth: width } : undefined}>
          {title ? <PageTitle>{title}</PageTitle> : null}
          {children}
        </div>
      </div>
      {footer != null ? (
        <div className="ad-main-footer">
          <div className="ad-main-footer-inner">{footer}</div>
        </div>
      ) : null}
    </main>
  )
}

export interface RightPanelGroup {
  title: ReactNode
  items: { label: ReactNode; icon?: string; onClick?: () => void; title?: string }[]
}

export function RightPanel({ label, width, groups, children, className }: { label?: string; width?: number | string; groups?: RightPanelGroup[]; children?: ReactNode; className?: string }) {
  return (
    <aside className={cx('ad-panel', className)} aria-label={label || 'Context'} style={width != null ? { width } : undefined}>
      {(groups ?? []).map((g, i) => (
        <div className="ad-panel-group" key={i}>
          <p className="ad-panel-title">{g.title}</p>
          {g.items.map((it, j) => (
            <button type="button" className="ad-panel-item" key={j} onClick={it.onClick} title={it.title}>
              {it.icon ? <Icon name={it.icon} /> : null}
              {it.label}
            </button>
          ))}
        </div>
      ))}
      {children}
    </aside>
  )
}

export interface EmptyStateProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  note?: ReactNode
  align?: 'start' | 'center'
  children?: ReactNode
  className?: string
}

export function EmptyState({ title, description, actions, note, align, children, className }: EmptyStateProps) {
  return (
    <div className={cx('ad-empty', align === 'center' && 'ad-empty-center', className)}>
      <h2 className="ad-empty-title">{title}</h2>
      {description ? <p className="ad-empty-desc">{description}</p> : null}
      {children}
      {actions ? <div className="ad-empty-actions">{actions}</div> : null}
      {note ? <p className="ad-empty-note">{note}</p> : null}
    </div>
  )
}
