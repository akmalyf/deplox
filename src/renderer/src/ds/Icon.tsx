import type { CSSProperties } from 'react'
import { ICON_PATHS, ICON_PATHS_24, type IconName } from './icons'
import { cx } from './cx'

export interface IconProps {
  name: IconName | (string & {})
  size?: number
  label?: string
  className?: string
  style?: CSSProperties
}

export function Icon({ name, size = 16, label, className, style }: IconProps) {
  const d24 = ICON_PATHS_24[name]
  const d = d24 ?? ICON_PATHS[name as IconName] ?? ICON_PATHS.circle
  return (
    <svg
      className={cx('ad-icon', className)}
      width={size}
      height={size}
      viewBox={d24 ? '0 0 24 24' : '0 0 16 16'}
      fill="none"
      stroke="currentColor"
      strokeWidth={d24 ? 2.25 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      style={style}
    >
      <path d={d} />
    </svg>
  )
}
