import { useEffect, useRef, type ReactNode } from 'react'

/** Scrim + dialog card with focus trap-lite: focuses the first control, Escape cancels. */
export function Modal({ label, onCancel, children, width = 460, role = 'dialog' }: { label: string; onCancel?: () => void; children: ReactNode; width?: number; role?: 'dialog' | 'alertdialog' }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    const first = el?.querySelector<HTMLElement>('[data-autofocus], input:not([type="checkbox"]), button.ad-btn-primary, button')
    first?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onCancel) {
        e.stopPropagation()
        onCancel()
      }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]')]
        if (!items.length) return
        const i = items.indexOf(document.activeElement as HTMLElement)
        if (e.shiftKey && i <= 0) {
          e.preventDefault()
          items[items.length - 1].focus()
        } else if (!e.shiftKey && i === items.length - 1) {
          e.preventDefault()
          items[0].focus()
        }
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onCancel])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel?.()}>
      <div ref={ref} className="dialog" role={role} aria-modal="true" aria-label={label} style={{ width }}>
        {children}
      </div>
    </div>
  )
}
