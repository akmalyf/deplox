import type { DeploxApi } from '../shared/ipc'

declare global {
  interface Window {
    deplox: DeploxApi
  }
}

export {}
