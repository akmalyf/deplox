import type { ChangeEvent, KeyboardEvent } from 'react'
import { Icon } from './Icon'
import { cx } from './cx'

export interface SearchInputProps {
  placeholder?: string
  label?: string
  value?: string
  defaultValue?: string
  variant?: 'raised' | 'sidebar'
  width?: number | string
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void
  onValueChange?: (v: string) => void
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  autoFocus?: boolean
  className?: string
}

export function SearchInput({ placeholder, label, value, defaultValue, variant, width, onChange, onValueChange, onKeyDown, autoFocus, className }: SearchInputProps) {
  return (
    <label className={cx('ad-search', variant === 'sidebar' && 'ad-search-sidebar', className)} style={width != null ? { width } : undefined}>
      <Icon name="search" />
      <input
        type="search"
        placeholder={placeholder || 'Search'}
        value={value}
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          onChange?.(e)
          onValueChange?.(e.target.value)
        }}
        aria-label={label || placeholder || 'Search'}
      />
    </label>
  )
}
