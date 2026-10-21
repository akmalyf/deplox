import { parseIpcError, type InvokeChannel, type InvokeMap } from '@shared/ipc'

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export async function invoke<K extends InvokeChannel>(channel: K, ...req: InvokeMap[K][0] extends void ? [] : [InvokeMap[K][0]]): Promise<InvokeMap[K][1]> {
  try {
    return await (window.deplox.invoke as (c: K, ...r: unknown[]) => Promise<InvokeMap[K][1]>)(channel, ...req)
  } catch (e) {
    const { code, message } = parseIpcError(e)
    throw new AppError(code, message)
  }
}

export function errorText(e: unknown): string {
  if (e instanceof AppError) return e.message
  return parseIpcError(e).message
}

export function errorCode(e: unknown): string {
  return e instanceof AppError ? e.code : parseIpcError(e).code
}

export const isMac = window.deplox.platform === 'darwin'
export const MOD = isMac ? '⌘' : 'Ctrl+'
export const ALT = isMac ? '⌥' : 'Alt+'
