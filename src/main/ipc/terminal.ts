import { handle, on } from './register'
import type { Services } from '../services'

export function registerTerminal(s: Services): void {
  handle('terminal:open', (req) => s.terminals.open(req))
  handle('terminal:close', (sid) => s.terminals.close(sid))
  on('terminal:write', ({ sessionId, data }) => s.terminals.write(sessionId, data))
  on('terminal:resize', ({ sessionId, cols, rows }) => s.terminals.resize(sessionId, cols, rows))
  on('terminal:ack', ({ sessionId, bytes }) => s.terminals.ack(sessionId, bytes))
}
