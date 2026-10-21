// pnpm can drop the executable bit on node-pty's spawn-helper; posix_spawnp then fails.
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const base = join(process.cwd(), 'node_modules/node-pty')
const dirs = [join(base, 'build/Release'), ...(existsSync(join(base, 'prebuilds')) ? readdirSync(join(base, 'prebuilds')).map((d) => join(base, 'prebuilds', d)) : [])]
for (const d of dirs) {
  const f = join(d, 'spawn-helper')
  if (existsSync(f)) chmodSync(f, 0o755)
}
