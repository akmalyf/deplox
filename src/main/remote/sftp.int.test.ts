// Integration test against dev/test-server.mjs (run: node dev/test-server.mjs, then pnpm test:int)
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client, type SFTPWrapper } from 'ssh2'
import { SftpFs } from './SftpFs'
import { RemoteFsError } from './errors'
import { walkRemote } from '../transfers/walk'

let fs: SftpFs
const tmp = mkdtempSync(join(tmpdir(), 'deplox-int-'))
const BASE = '/tmp-int-' + Date.now()

beforeAll(async () => {
  const client = new Client()
  await new Promise<void>((res, rej) => {
    client.once('ready', () => res()).once('error', rej)
    client.connect({ host: '127.0.0.1', port: 2222, username: 'deploy', password: 'pass', hostVerifier: () => true })
  })
  const sftp = await new Promise<SFTPWrapper>((res, rej) => client.sftp((e, s) => (e ? rej(e) : res(s))))
  fs = new SftpFs(client, sftp)
})

afterAll(async () => {
  await fs?.close()
})

describe('SftpFs against the dev server', () => {
  it('lists the seeded app', async () => {
    const list = await fs.list('/var/www/app')
    const names = list.map((e) => e.name).sort()
    expect(names).toContain('app')
    expect(names).toContain('composer.json')
    expect(list.find((e) => e.name === 'app')?.type).toBe('dir')
    expect(await fs.realpath('.')).toBe('/home/deploy')
  })

  it('walks a tree with parallel listings and finds every file once', async () => {
    const seq: string[] = []
    const visit = async (dir: string) => {
      for (const e of await fs.list(dir)) {
        if (e.type === 'dir') await visit(e.path)
        else if (e.type === 'file') seq.push(e.path)
      }
    }
    await visit('/var/www/app')
    const w = await walkRemote(fs, '/var/www/app', () => false)
    expect(w.files.map((f) => f.path).sort()).toEqual(seq.sort())
    expect(seq.length).toBeGreaterThan(0)
  })

  it('mkdir -p, upload, stat, download', async () => {
    await fs.mkdir(`${BASE}/a/b`, true)
    const src = join(tmp, 'up.bin')
    const data = Buffer.alloc(300_000, 7)
    writeFileSync(src, data)
    let last = 0
    await fs.upload(src, `${BASE}/a/b/up.bin`, { signal: new AbortController().signal, onProgress: (n) => (last = n) })
    expect(last).toBe(300_000)
    expect((await fs.stat(`${BASE}/a/b/up.bin`)).size).toBe(300_000)
    const dst = join(tmp, 'down.bin')
    await fs.download(`${BASE}/a/b/up.bin`, dst, { signal: new AbortController().signal, onProgress: () => undefined })
    expect(readFileSync(dst).equals(data)).toBe(true)
  })

  it('resumes an upload from an offset', async () => {
    const src = join(tmp, 'resume.txt')
    writeFileSync(src, 'hello world, resumed!')
    await fs.writeFile(`${BASE}/resume.txt`, Buffer.from('hello '))
    await fs.upload(src, `${BASE}/resume.txt`, { signal: new AbortController().signal, onProgress: () => undefined, startAt: 6 })
    expect((await fs.readFile(`${BASE}/resume.txt`)).toString()).toBe('hello world, resumed!')
  })

  it('aborts a transfer', async () => {
    const src = join(tmp, 'big.bin')
    writeFileSync(src, Buffer.alloc(8_000_000, 1))
    const ac = new AbortController()
    const p = fs.upload(src, `${BASE}/big.bin`, { signal: ac.signal, onProgress: (n) => n > 200_000 && ac.abort() })
    await expect(p).rejects.toMatchObject({ code: 'EABORT' })
  })

  it('rename, delete and ENOENT mapping', async () => {
    await fs.rename(`${BASE}/resume.txt`, `${BASE}/renamed.txt`)
    await fs.deleteFile(`${BASE}/renamed.txt`)
    const err = await fs.stat(`${BASE}/renamed.txt`).catch((e) => e)
    expect(err).toBeInstanceOf(RemoteFsError)
    expect((err as RemoteFsError).code).toBe('ENOENT')
    expect(statSync(tmp).isDirectory()).toBe(true)
  })
})
