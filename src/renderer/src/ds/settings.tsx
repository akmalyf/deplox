import { useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { cx } from './cx'

export function SettingsGroup({ label, children, className }: { label?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cx('ad-settings-group', className)} role="group" aria-label={label}>
      {children}
    </div>
  )
}

export function SettingRow({ title, description, control, children, className }: { title: ReactNode; description?: ReactNode; control?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cx('ad-setting-row', className)}>
      <div className="ad-setting-text">
        <p className="ad-setting-title">{title}</p>
        {description ? <p className="ad-setting-desc">{description}</p> : null}
      </div>
      {control != null || children != null ? (
        <div className="ad-setting-control">
          {control}
          {children}
        </div>
      ) : null}
    </div>
  )
}

export interface ToggleProps {
  checked?: boolean
  defaultChecked?: boolean
  disabled?: boolean
  label?: string
  onChange?: (on: boolean) => void
  className?: string
}

export function Toggle({ checked, defaultChecked, disabled, label, onChange, className }: ToggleProps) {
  const [own, setOwn] = useState(!!defaultChecked)
  const on = checked ?? own
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on ? 'true' : 'false'}
      aria-label={label}
      disabled={disabled}
      className={cx('ad-toggle', className)}
      onClick={() => {
        if (checked == null) setOwn(!on)
        onChange?.(!on)
      }}
    />
  )
}

export interface SelectProps {
  value: ReactNode
  icon?: string
  label?: string
  raised?: boolean
  disabled?: boolean
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  className?: string
}

export function Select({ value, icon, label, raised, disabled, onClick, className }: SelectProps) {
  return (
    <button type="button" className={cx('ad-select', raised && 'ad-select-raised', className)} aria-haspopup="listbox" aria-label={label} onClick={onClick} disabled={disabled}>
      {icon ? <Icon name={icon} /> : null}
      {value}
      <Icon name="chevron-down" />
    </button>
  )
}
