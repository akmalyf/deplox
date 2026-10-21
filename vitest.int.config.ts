import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { include: ['src/**/*.int.test.ts'], environment: 'node', testTimeout: 20_000 }
})
