import { createHash } from 'node:crypto'

/** Parse the SSH wire-format public key blob: string keyType, … */
export function keyType(key: Buffer): string {
  try {
    const len = key.readUInt32BE(0)
    if (len > 0 && len < 64) return key.subarray(4, 4 + len).toString('ascii')
  } catch {
    /* fall through */
  }
  return 'unknown'
}

export function fingerprint(key: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
}

export function displayKeyType(type: string): string {
  if (type === 'ssh-ed25519') return 'ED25519'
  if (type === 'ssh-rsa' || type.startsWith('rsa-')) return 'RSA'
  if (type.startsWith('ecdsa')) return 'ECDSA'
  if (type === 'ssh-dss') return 'DSA'
  return type.toUpperCase()
}
