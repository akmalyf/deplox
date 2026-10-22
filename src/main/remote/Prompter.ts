import type { PromptAnswer, PromptPayload } from '@shared/types'
import { id } from '@shared/ids'
import { emit } from '../events'

interface Pending {
  resolve: (a: PromptAnswer) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
  key: string
  promise: Promise<PromptAnswer>
}

/** Ask the renderer a question and await the answer (host key, password, overwrite…). */
export class Prompter {
  private readonly pending = new Map<string, Pending>()
  private readonly byKey = new Map<string, string>()

  ask(payload: PromptPayload, timeoutMs = 5 * 60_000): Promise<PromptAnswer> {
    const key = `${payload.kind}:${payload.hostId}:${'remotePath' in payload ? payload.remotePath : ''}`
    const existing = this.byKey.get(key)
    if (existing && this.pending.has(existing)) return this.pending.get(existing)!.promise

    const requestId = id('pr')
    let resolve!: (a: PromptAnswer) => void
    let reject!: (e: Error) => void
    const promise = new Promise<PromptAnswer>((res, rej) => {
      resolve = res
      reject = rej
    })
    const timer = setTimeout(() => {
      this.finish(requestId)
      emit('prompt:cancel', { requestId })
      reject(new Error('[EABORT] No answer'))
    }, timeoutMs)
    this.pending.set(requestId, { resolve, reject, timer, key, promise })
    this.byKey.set(key, requestId)
    emit('prompt:open', { requestId, payload })
    return promise
  }

  answer(requestId: string, answer: PromptAnswer): void {
    const p = this.pending.get(requestId)
    if (!p) return
    this.finish(requestId)
    p.resolve(answer)
    // Other windows showing the same prompt drop it.
    emit('prompt:cancel', { requestId })
  }

  cancelAll(): void {
    for (const [rid, p] of this.pending) {
      this.finish(rid)
      p.reject(new Error('[EABORT] Canceled'))
    }
  }

  private finish(requestId: string): void {
    const p = this.pending.get(requestId)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(requestId)
    if (this.byKey.get(p.key) === requestId) this.byKey.delete(p.key)
  }
}
