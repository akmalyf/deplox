export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1000) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1000
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

export function formatSpeed(bps: number): string {
  return bps > 0 ? `${formatBytes(bps)}/s` : ''
}

export function formatClock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function formatWhen(ms: number, now = Date.now()): string {
  const d = new Date(ms)
  const today = new Date(now)
  if (d.toDateString() === today.toDateString()) return formatClock(ms)
  const month = d.toLocaleString('en', { month: 'short' })
  return `${month} ${d.getDate()}, ${formatClock(ms)}`
}

export function formatAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return formatWhen(ms, now)
}

export function formatDuration(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return [h, m, s].map((x) => String(x).padStart(2, '0')).join(':')
}

export function initials(name: string): string {
  const parts = name.split(/[\s\-_.]+/).filter(Boolean)
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return s.toUpperCase()
}

export const PROJECT_COLORS = ['#2f7a76', '#3b6fb6', '#8a4fa8', '#a4552c', '#5b7f2f', '#9c3f5c']
