import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

/** Small JSON file store: synchronous load, debounced atomic writes (tmp + rename). */
export class JsonStore<T> {
  private data: T
  private timer: NodeJS.Timeout | null = null

  constructor(
    readonly file: string,
    defaults: () => T,
    migrate: (raw: unknown) => T = (raw) => raw as T,
    private readonly delay = 250
  ) {
    this.data = defaults()
    if (existsSync(file)) {
      try {
        this.data = migrate(JSON.parse(readFileSync(file, 'utf8')))
      } catch (err) {
        console.error(`[store] ${file} is unreadable, starting fresh`, err)
        try {
          renameSync(file, `${file}.corrupt-${Date.now()}`)
        } catch {
          /* ignore */
        }
        this.data = defaults()
      }
    }
  }

  get(): T {
    return this.data
  }

  update(fn: (draft: T) => T): T {
    this.data = fn(this.data)
    this.schedule()
    return this.data
  }

  set(next: T): void {
    this.data = next
    this.schedule()
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.delay)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
  }
}
