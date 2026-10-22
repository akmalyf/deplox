import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { Kbd } from './primitives'
import { cx } from './cx'

export function Menu({ label, width, children, className, style }: { label?: string; width?: number | string; children?: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx('ad-menu', className)} role="menu" aria-label={label} style={{ ...(width != null ? { width } : {}), ...style }}>
      {children}
    </div>
  )
}

export interface MenuItemProps {
  icon?: string
  shortcut?: string
  danger?: boolean
  separator?: boolean
  disabled?: boolean
  onClick?: () => void
  children?: ReactNode
  className?: string
}

export function MenuItem({ icon, shortcut, danger, separator, disabled, onClick, children, className }: MenuItemProps) {
  if (separator) return <div className="ad-menu-sep" role="separator" />
  return (
    <button type="button" role="menuitem" disabled={disabled} className={cx('ad-menu-item', danger && 'ad-menu-item-danger', className)} onClick={onClick} style={disabled ? { opacity: 'var(--opacity-disabled)' as unknown as number } : undefined}>
      {icon ? <Icon name={icon} /> : null}
      <span className="ad-menu-item-label">{children}</span>
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </button>
  )
}

export interface MenuPopoverProps {
  /** Viewport coordinates of the anchor point (top-left of the menu). */
  x: number
  y: number
  onClose: () => void
  label?: string
  width?: number
  children?: ReactNode
}

/** Fixed-position menu that stays inside the viewport and closes on outside click or Escape. */
export function MenuPopover({ x, y, onClose, label, width = 240, children }: MenuPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8))
    const top = y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y
    setPos({ left, top })
  }, [x, y])

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const t = setTimeout(() => {
      window.addEventListener('mousedown', down, true)
      window.addEventListener('contextmenu', down, true)
    })
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', onClose)
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('contextmenu', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  // Portaled to <body> so a clipping or stacking ancestor (the sidebar) can't cut the menu off.
  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 'var(--z-popover)' as unknown as number }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[role="menuitem"]')) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        e.preventDefault()
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
        const i = items.indexOf(document.activeElement as HTMLElement)
        const n = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
        items[n]?.focus()
      }}
    >
      <Menu label={label} width={width}>
        {children}
      </Menu>
    </div>,
    document.body
  )
}
