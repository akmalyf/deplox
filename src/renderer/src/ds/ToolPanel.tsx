import type { CSSProperties, ReactNode } from 'react'
import { Icon } from './Icon'
import { Button } from './Button'
import { cx } from './cx'

export interface PaneTabProps {
  icon?: string
  active?: boolean
  closable?: boolean
  onSelect?: () => void
  onClose?: () => void
  children?: ReactNode
  className?: string
}

export function PaneTab({ icon, active, closable, onSelect, onClose, children, className }: PaneTabProps) {
  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active ? 'true' : 'false'}
      className={cx('ad-pane-tab ad-focusable', active && 'ad-pane-tab-active', className)}
      onClick={onSelect}
      onAuxClick={(e) => {
        if (e.button === 1 && closable !== false && onClose) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect?.()
        }
      }}
    >
      {icon ? <Icon name={icon} /> : null}
      <span className="ad-pane-tab-label">{children}</span>
      {closable !== false ? (
        <span
          className="ad-pane-tab-close"
          role="button"
          aria-label="Close tab"
          onClick={(e) => {
            e.stopPropagation()
            onClose?.()
          }}
        >
          <Icon name="x" />
        </span>
      ) : null}
    </div>
  )
}

export interface ToolPanelTab {
  id: string
  label: ReactNode
  icon?: string
  closable?: boolean
}

export interface ToolPanelProps {
  tabs: ToolPanelTab[]
  activeId?: string
  title?: ReactNode
  headerActions?: ReactNode
  tabActions?: ReactNode
  docked?: boolean
  label?: string
  width?: number | string
  height?: number | string
  style?: CSSProperties
  onSelect?: (id: string) => void
  onClose?: (id: string) => void
  onAdd?: () => void
  addLabel?: string
  children?: ReactNode
  className?: string
}

export function ToolPanel({ tabs, activeId, title, headerActions, tabActions, docked, label, width, height, style, onSelect, onClose, onAdd, addLabel, children, className }: ToolPanelProps) {
  const active = activeId ?? tabs[0]?.id
  const current = tabs.find((t) => t.id === active)
  return (
    <section className={cx('ad-toolpanel', docked && 'ad-toolpanel-docked', className)} aria-label={label || 'Tools'} style={{ width, height, ...style }}>
      <div className="ad-toolpanel-tabs" role="tablist">
        {tabs.map((t) => (
          <PaneTab key={t.id} icon={t.icon} active={t.id === active} closable={t.closable} onSelect={() => onSelect?.(t.id)} onClose={() => onClose?.(t.id)}>
            {t.label}
          </PaneTab>
        ))}
        {onAdd ? (
          <Button variant="ghost" iconOnly icon="plus" size="sm" onClick={onAdd}>
            {addLabel ?? 'New tab'}
          </Button>
        ) : null}
        <span className="ad-toolpanel-tabs-spacer" />
        {tabActions}
      </div>
      {title != null || current ? (
        <div className="ad-toolpanel-head">
          <span className="ad-toolpanel-head-title">{title ?? current?.label}</span>
          {headerActions}
        </div>
      ) : null}
      <div className="ad-toolpanel-body">{children}</div>
    </section>
  )
}
