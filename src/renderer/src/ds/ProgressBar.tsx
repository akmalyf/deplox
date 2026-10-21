import type { ReactNode } from 'react'
import { cx } from './cx'

export interface ProgressBarProps {
  value: number
  label?: ReactNode
  valueLabel?: ReactNode
  caption?: ReactNode
  tone?: 'accent' | 'success' | 'danger'
  className?: string
  ariaLabel?: string
}

export function ProgressBar({ value, label, valueLabel, caption, tone, className, ariaLabel }: ProgressBarProps) {
  const v = Math.max(0, Math.min(100, value || 0))
  return (
    <div className={cx('ad-progress', className)}>
      {label != null ? (
        <div className="ad-progress-head">
          <span className="ad-progress-label">{label}</span>
          <span className="ad-progress-value">{valueLabel ?? `${Math.round(v)}%`}</span>
        </div>
      ) : null}
      <div className="ad-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={typeof label === 'string' ? label : ariaLabel}>
        <div className={cx('ad-progress-fill', tone === 'success' && 'ad-progress-fill-success', tone === 'danger' && 'ad-progress-fill-danger')} style={{ width: `${v}%` }} />
      </div>
      {caption ? <div className="ad-progress-caption">{caption}</div> : null}
    </div>
  )
}
