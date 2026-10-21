import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { Kbd } from './primitives'
import { cx } from './cx'

export interface NavItemProps {
  icon?: string
  selected?: boolean
  external?: boolean
  /** A string renders as a Kbd chip. */
  trailing?: ReactNode
  onClick?: () => void
  children?: ReactNode
  className?: string
  title?: string
}

export function NavItem({ icon, selected, external, trailing, onClick, children, className, title }: NavItemProps) {
  return (
    <button
      type="button"
      title={title}
      className={cx('ad-nav-item', selected && 'ad-nav-item-selected', external && 'ad-nav-item-external', className)}
      aria-current={selected ? 'page' : undefined}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} /> : null}
      <span className="ad-nav-label">{children}</span>
      {trailing != null && trailing !== '' ? <span className="ad-nav-trailing">{typeof trailing === 'string' ? <Kbd>{trailing}</Kbd> : trailing}</span> : null}
    </button>
  )
}

export function NavGroup({ label, children, className }: { label?: string; children?: ReactNode; className?: string }) {
  return (
    <nav className={cx('ad-nav', className)} aria-label={label}>
      {children}
    </nav>
  )
}
