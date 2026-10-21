import { JsonStore } from './JsonStore'

export interface KnownHost {
  keyType: string
  fingerprint: string
  addedAt: number
}

export class KnownHosts {
  private readonly store: JsonStore<Record<string, KnownHost>>

  constructor(file: string) {
    this.store = new JsonStore(file, () => ({}))
  }

  private key(host: string, port: number): string {
    return `${host.toLowerCase()}:${port}`
  }

  get(host: string, port: number): KnownHost | undefined {
    return this.store.get()[this.key(host, port)]
  }

  set(host: string, port: number, entry: KnownHost): void {
    this.store.update((s) => ({ ...s, [this.key(host, port)]: entry }))
  }

  delete(host: string, port: number): void {
    this.store.update((s) => {
      const next = { ...s }
      delete next[this.key(host, port)]
      return next
    })
  }

  flush(): void {
    this.store.flush()
  }
}
