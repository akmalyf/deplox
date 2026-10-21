import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon } from './Icon'
import { cx } from './cx'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** secondary (bg-control) · primary (fill-inverse) · accent · outline · ghost · link */
  variant?: 'primary' | 'secondary' | 'accent' | 'outline' | 'ghost' | 'link'
  size?: 'sm' | 'md'
  icon?: string
  trailingIcon?: string
  /** Hides the label and uses it as aria-label. */
  iconOnly?: boolean
  round?: boolean
  children?: ReactNode
}

export function Button({ variant = 'secondary', size = 'md', icon, trailingIcon, iconOnly, round, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      {...rest}
      title={rest.title ?? (iconOnly && typeof children === 'string' ? children : undefined)}
      className={cx('ad-btn', `ad-btn-${variant}`, size === 'sm' && 'ad-btn-sm', iconOnly && 'ad-btn-icon', round && 'ad-btn-round', className)}
      aria-label={iconOnly && typeof children === 'string' ? children : rest['aria-label']}
    >
      {icon ? <Icon name={icon} /> : null}
      {iconOnly ? null : children}
      {trailingIcon ? <Icon name={trailingIcon} /> : null}
    </button>
  )
}
