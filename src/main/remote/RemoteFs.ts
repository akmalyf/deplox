import type { FsEntry, Protocol } from '@shared/types'

export interface TransferControl {
  signal: AbortSignal
  /** Called with the total number of bytes present at the destination. */
  onProgress: (bytes: number) => void
  /** Resume offset: bytes already present at the destination. */
  startAt?: number
  /** POSIX mode to apply to an uploaded file. */
  mode?: number
}

export interface RemoteFs {
  readonly protocol: Protocol
  readonly closed: boolean
  list(dir: string): Promise<FsEntry[]>
  stat(path: string): Promise<FsEntry>
  mkdir(path: string, recursive?: boolean): Promise<void>
  rename(from: string, to: string): Promise<void>
  deleteFile(path: string): Promise<void>
  /** Removes an empty directory. */
  deleteDir(path: string): Promise<void>
  readFile(path: string, maxBytes?: number): Promise<Buffer>
  writeFile(path: string, data: Buffer, mode?: number): Promise<void>
  download(remote: string, localPath: string, ctl: TransferControl): Promise<void>
  upload(localPath: string, remote: string, ctl: TransferControl): Promise<void>
  chmod(path: string, mode: number): Promise<void>
  realpath(path: string): Promise<string>
  /** Round trip in ms. */
  ping(): Promise<number>
  close(): Promise<void>
}
