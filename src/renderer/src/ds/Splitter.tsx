import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { cx } from './cx'

export interface SplitterProps {
  /** `vertical` sits between columns and drags left/right; `horizontal` sits between rows and drags up/down. */
  orientation: 'vertical' | 'horizontal'
  /** Pixels moved since the last call (positive = right/down). */
  onDrag: (delta: number) => void
  /** Double-click restores the default size. */
  onReset?: () => void
  label: string
  className?: string
}

export function Splitter({ orientation, onDrag, onReset, label, className }: SplitterProps) {
  const last = useRef<number | null>(null)
  const pos = (e: PointerEvent) => (orientation === 'vertical' ? e.clientX : e.clientY)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    last.current = pos(e)
    document.body.classList.add(orientation === 'vertical' ? 'resizing-col' : 'resizing-row')
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (last.current == null) return
    const p = pos(e)
    if (p !== last.current) onDrag(p - last.current)
    last.current = p
  }
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (last.current == null) return
    last.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.classList.remove('resizing-col', 'resizing-row')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16
    const back = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp'
    const fwd = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
    if (e.key === back) onDrag(-step)
    else if (e.key === fwd) onDrag(step)
    else if (e.key === 'Enter' && onReset) onReset()
    else return
    e.preventDefault()
  }

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      tabIndex={0}
      className={cx('ad-splitter ad-focusable', `ad-splitter-${orientation}`, className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  )
}
