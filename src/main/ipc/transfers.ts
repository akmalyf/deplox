import { handle } from './register'
import type { Services } from '../services'

export function registerTransfers(s: Services): void {
  handle('transfers:enqueue', (reqs) => s.queue.enqueue(reqs))
  handle('transfers:cancel', (ids) => s.queue.cancel(ids))
  handle('transfers:pause', (ids) => s.queue.pause(ids))
  handle('transfers:resume', (ids) => s.queue.resume(ids))
  handle('transfers:retry', ({ ids, restart }) => s.queue.retry(ids, restart))
  handle('transfers:remove', (ids) => s.queue.remove(ids))
  handle('transfers:pauseAll', () => s.queue.pauseAll())
  handle('transfers:resumeAll', () => s.queue.resumeAll())
  handle('transfers:clearDone', () => s.queue.clearDone())
}
