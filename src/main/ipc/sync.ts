import { handle } from './register'
import type { Services } from '../services'

export function registerSync(s: Services): void {
  handle('sync:scan', (projectId) => s.sync.scan(projectId))
  handle('sync:run', (ids) => s.sync.run(ids))
  handle('sync:remove', (ids) => s.sync.remove(ids))
  handle('sync:resolve', ({ id, resolution }) => s.sync.resolve(id, resolution))
  handle('sync:clearDone', () => s.sync.clearDone())
  handle('sync:setWatching', ({ projectId, on }) => s.sync.setWatching(projectId, on))
}
