import type { Services } from '../services'
import { registerApp } from './app'
import { registerHosts } from './hosts'
import { registerFs } from './fs'
import { registerTransfers } from './transfers'
import { registerCompare } from './compare'
import { registerTerminal } from './terminal'
import { registerSync } from './sync'

export function registerIpc(s: Services): void {
  registerApp(s)
  registerHosts(s)
  registerFs(s)
  registerTransfers(s)
  registerCompare(s)
  registerTerminal(s)
  registerSync(s)
}
