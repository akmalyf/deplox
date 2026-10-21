import { safeStorage } from 'electron'
import type { JsonStore } from './JsonStore'
import type { StoreV1 } from './schema'

export type SecretKind = 'password' | 'passphrase'

export function secretRef(hostId: string, kind: SecretKind): string {
  return `${hostId}:${kind}`
}

export class Secrets {
  /** Session-only secrets (entered without "save"). Never persisted. */
  private readonly session = new Map<string, string>()

  constructor(private readonly store: JsonStore<StoreV1>) {}

  available(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  get(ref: string): string | null {
    const mem = this.session.get(ref)
    if (mem != null) return mem
    const enc = this.store.get().secrets[ref]
    if (!enc || !this.available()) return null
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  }

  has(ref: string): boolean {
    return this.session.has(ref) || !!this.store.get().secrets[ref]
  }

  hasStored(ref: string): boolean {
    return !!this.store.get().secrets[ref]
  }

  /** Persist when `save` and the keychain is available, otherwise keep for this session only. */
  set(ref: string, value: string, save: boolean): void {
    this.session.set(ref, value)
    if (save && this.available()) {
      const enc = safeStorage.encryptString(value).toString('base64')
      this.store.update((s) => ({ ...s, secrets: { ...s.secrets, [ref]: enc } }))
    } else if (!save) {
      this.deleteStored(ref)
    }
  }

  forgetSession(ref: string): void {
    this.session.delete(ref)
  }

  deleteStored(ref: string): void {
    if (!this.store.get().secrets[ref]) return
    this.store.update((s) => {
      const next = { ...s.secrets }
      delete next[ref]
      return { ...s, secrets: next }
    })
  }

  deleteHost(hostId: string): void {
    for (const kind of ['password', 'passphrase'] as const) {
      const ref = secretRef(hostId, kind)
      this.session.delete(ref)
      this.deleteStored(ref)
    }
  }

  copyHost(fromId: string, toId: string): void {
    const s = this.store.get().secrets
    for (const kind of ['password', 'passphrase'] as const) {
      const v = s[secretRef(fromId, kind)]
      if (v) this.store.update((st) => ({ ...st, secrets: { ...st.secrets, [secretRef(toId, kind)]: v } }))
    }
  }
}
