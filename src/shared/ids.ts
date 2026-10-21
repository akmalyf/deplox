export function id(prefix = ''): string {
  const r = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return prefix ? `${prefix}_${r}` : r
}
