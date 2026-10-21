import type { MouseEvent, ReactNode } from 'react'
import { Icon } from './Icon'
import { cx } from './cx'

export function Kbd({ children, className }: { children?: ReactNode; className?: string }) {
  return <kbd className={cx('ad-kbd', className)}>{children}</kbd>
}

export type Tone = 'neutral' | 'accent' | 'success' | 'warning'

export function Badge({ tone, children, className }: { tone?: Tone; children?: ReactNode; className?: string }) {
  return <span className={cx('ad-badge', tone && tone !== 'neutral' && `ad-badge-${tone}`, className)}>{children}</span>
}

export type Status = 'neutral' | 'success' | 'warning' | 'danger'

export function StatusDot({ status = 'neutral', label, className }: { status?: Status; label?: string; className?: string }) {
  return <span className={cx('ad-dot', status !== 'neutral' && `ad-dot-${status}`, className)} role="img" aria-label={label || status} title={label} />
}

export interface ChipProps {
  selected?: boolean
  shape?: 'pill' | 'square'
  icon?: string
  trailingIcon?: string
  disabled?: boolean
  onClick?: () => void
  /** Click on the trailing icon only (removable chips). */
  onTrailingClick?: () => void
  trailingLabel?: string
  children?: ReactNode
  className?: string
  title?: string
}

export function Chip({ selected, shape = 'pill', icon, trailingIcon, disabled, onClick, onTrailingClick, trailingLabel, children, className, title }: ChipProps) {
  const trailing = trailingIcon ? (
    onTrailingClick ? (
      <span
        role="button"
        tabIndex={0}
        aria-label={trailingLabel ?? 'Remove'}
        style={{ display: 'inline-flex' }}
        onClick={(e: MouseEvent) => {
          e.stopPropagation()
          onTrailingClick()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            onTrailingClick()
          }
        }}
      >
        <Icon name={trailingIcon} />
      </span>
    ) : (
      <Icon name={trailingIcon} />
    )
  ) : null
  return (
    <button
      type="button"
      title={title}
      className={cx('ad-chip', selected && 'ad-chip-selected', shape === 'square' && 'ad-chip-square', className)}
      aria-pressed={selected ? 'true' : 'false'}
      onClick={onClick}
      disabled={disabled}
    >
      {icon ? <Icon name={icon} /> : null}
      {children}
      {trailing}
    </button>
  )
}

export function Avatar({ name, src, size, className }: { name: string; src?: string; size?: 'md' | 'lg'; className?: string }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return (
    <span className={cx('ad-avatar', size === 'lg' && 'ad-avatar-lg', className)} role="img" aria-label={name}>
      {src ? <img src={src} alt="" /> : initials}
    </span>
  )
}

export function PageTitle({ children, className }: { children?: ReactNode; className?: string }) {
  return <h1 className={cx('ad-page-title', className)}>{children}</h1>
}

export function SectionLabel({ variant, actions, children, className }: { variant?: 'content' | 'sidebar'; actions?: ReactNode; children?: ReactNode; className?: string }) {
  if (variant === 'sidebar')
    return (
      <div className={cx('ad-section-label-sidebar', className)}>
        <span>{children}</span>
        {actions ? <span className="ad-nav-trailing">{actions}</span> : null}
      </div>
    )
  return <h2 className={cx('ad-section-label', className)}>{children}</h2>
}
