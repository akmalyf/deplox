import type { Settings } from '@shared/types'
import { isMac } from './ipc'

const media = window.matchMedia('(prefers-color-scheme: dark)')
let current: Settings | null = null

function resolve(s: Settings): 'dark' | 'light' {
  if (s.theme === 'system') return media.matches ? 'dark' : 'light'
  return s.theme
}

export function applyTheme(s: Settings): void {
  current = s
  const root = document.documentElement
  root.dataset.theme = resolve(s)
  root.classList.toggle('glass', isMac && !s.reduceTransparency)
}

export function glassEnabled(s: Settings): boolean {
  return isMac && !s.reduceTransparency
}

media.addEventListener('change', () => {
  if (current?.theme === 'system') applyTheme(current)
})
