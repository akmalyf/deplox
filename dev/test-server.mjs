// Local SFTP + SSH shell server for development. Serves a folder as the remote root.
//   node dev/test-server.mjs [root] [port]
// Login: deploy / pass   (or any key listed in dev/.authorized_keys)
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import fs from 'node:fs'
import { join, resolve, dirname, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import ssh2 from 'ssh2'

const require = createRequire(import.meta.url)
const { Server, utils } = ssh2
const { OPEN_MODE, STATUS_CODE } = utils.sftp
const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(process.argv[2] ?? join(here, 'remote'))
const PORT = Number(process.argv[3] ?? 2222)
const USER = 'deploy'
const PASS = 'pass'

mkdirSync(ROOT, { recursive: true })
const keyFile = join(here, '.host_key')
if (!existsSync(keyFile)) {
  const kp = utils.generateKeyPairSync('ed25519')
  writeFileSync(keyFile, kp.private, { mode: 0o600 })
}
const hostKey = readFileSync(keyFile)

// Map a client path ("/var/www/app") into ROOT.
const toLocal = (p) => join(ROOT, posix.normalize('/' + p))
const toClient = (abs) => '/' + abs.slice(ROOT.length).replace(/^\/+/, '')

function attrs(st) {
  return { mode: st.mode, uid: st.uid, gid: st.gid, size: st.size, atime: Math.floor(st.atimeMs / 1000), mtime: Math.floor(st.mtimeMs / 1000) }
}

function longname(name, st) {
  const t = st.isDirectory() ? 'd' : '-'
  return `${t}rw-r--r-- 1 deploy deploy ${st.size} Jan 1 00:00 ${name}`
}

function flagsOf(f) {
  const s = utils.sftp.flagsToString(f)
  return s ?? 'r'
}

function errCode(e) {
  if (e?.code === 'ENOENT') return STATUS_CODE.NO_SUCH_FILE
  if (e?.code === 'EACCES' || e?.code === 'EPERM') return STATUS_CODE.PERMISSION_DENIED
  return STATUS_CODE.FAILURE
}

new Server({ hostKeys: [hostKey], ident: 'DeploxTestServer_1.0' }, (client) => {
  client
    .on('authentication', (ctx) => {
      if (ctx.username === USER && ctx.method === 'password' && ctx.password === PASS) return ctx.accept()
      ctx.reject(['password'])
    })
    .on('ready', () => {
      client.on('session', (accept) => {
        const session = accept()
        let ptyInfo = { cols: 100, rows: 30 }
        session.on('pty', (accept, _reject, info) => {
          ptyInfo = info
          accept?.()
        })
        session.on('window-change', (accept, _reject, info) => {
          ptyInfo = info
          session._pty?.resize(info.cols, info.rows)
          accept?.()
        })
        session.on('env', (accept) => accept?.())
        session.on('shell', (accept) => {
          const stream = accept()
          const pty = require('node-pty')
          const p = pty.spawn(process.env.SHELL || '/bin/zsh', ['-l'], { name: 'xterm-256color', cols: ptyInfo.cols || 100, rows: ptyInfo.rows || 30, cwd: ROOT, env: { ...process.env, PS1: 'deploy@test-server:%~$ ' } })
          session._pty = p
          p.onData((d) => stream.write(d))
          p.onExit(({ exitCode }) => {
            stream.exit(exitCode)
            stream.end()
          })
          stream.on('data', (d) => p.write(d.toString()))
          stream.on('close', () => p.kill())
        })
        session.on('sftp', (accept) => {
          const sftp = accept()
          const handles = new Map()
          let next = 0
          const newHandle = (v) => {
            const b = Buffer.alloc(4)
            b.writeUInt32BE(next++)
            handles.set(b.toString('hex'), v)
            return b
          }
          const get = (h) => handles.get(h.toString('hex'))

          sftp.on('OPEN', (id, path, flags) => {
            try {
              const fd = fs.openSync(toLocal(path), flagsOf(flags))
              sftp.handle(id, newHandle({ fd, path }))
            } catch (e) {
              sftp.status(id, errCode(e))
            }
          })
          sftp.on('READ', (id, h, offset, len) => {
            const v = get(h)
            if (!v?.fd && v?.fd !== 0) return sftp.status(id, STATUS_CODE.FAILURE)
            const buf = Buffer.alloc(len)
            const n = fs.readSync(v.fd, buf, 0, len, offset)
            if (n === 0) return sftp.status(id, STATUS_CODE.EOF)
            sftp.data(id, buf.subarray(0, n))
          })
          sftp.on('WRITE', (id, h, offset, data) => {
            const v = get(h)
            try {
              fs.writeSync(v.fd, data, 0, data.length, offset)
              sftp.status(id, STATUS_CODE.OK)
            } catch (e) {
              sftp.status(id, errCode(e))
            }
          })
          sftp.on('FSTAT', (id, h) => {
            const v = get(h)
            try {
              sftp.attrs(id, attrs(fs.fstatSync(v.fd)))
            } catch (e) {
              sftp.status(id, errCode(e))
            }
          })
          sftp.on('CLOSE', (id, h) => {
            const v = get(h)
            if (v && typeof v.fd === 'number') fs.closeSync(v.fd)
            handles.delete(h.toString('hex'))
            sftp.status(id, STATUS_CODE.OK)
          })
          sftp.on('OPENDIR', (id, path) => {
            try {
              const abs = toLocal(path)
              const names = fs.readdirSync(abs)
              sftp.handle(id, newHandle({ dir: abs, names, done: false }))
            } catch (e) {
              sftp.status(id, errCode(e))
            }
          })
          sftp.on('READDIR', (id, h) => {
            const v = get(h)
            if (!v || v.done) return sftp.status(id, STATUS_CODE.EOF)
            v.done = true
            const list = v.names.map((n) => {
              const st = fs.lstatSync(join(v.dir, n))
              return { filename: n, longname: longname(n, st), attrs: attrs(st) }
            })
            if (!list.length) return sftp.status(id, STATUS_CODE.EOF)
            sftp.name(id, list)
          })
          const statHandler = (lstat) => (id, path) => {
            try {
              sftp.attrs(id, attrs(lstat ? fs.lstatSync(toLocal(path)) : fs.statSync(toLocal(path))))
            } catch (e) {
              sftp.status(id, errCode(e))
            }
          }
          sftp.on('STAT', statHandler(false))
          sftp.on('LSTAT', statHandler(true))
          sftp.on('REALPATH', (id, path) => {
            const p = path === '.' || path === '' ? '/home/deploy' : posix.normalize('/' + path)
            mkdirSync(toLocal('/home/deploy'), { recursive: true })
            sftp.name(id, [{ filename: p, longname: p, attrs: {} }])
          })
          const simple = (fn) => (id, ...args) => {
            try {
              fn(...args)
              sftp.status(id, STATUS_CODE.OK)
            } catch (e) {
              sftp.status(id, errCode(e))
            }
          }
          sftp.on('MKDIR', simple((p) => fs.mkdirSync(toLocal(p))))
          sftp.on('RMDIR', simple((p) => fs.rmdirSync(toLocal(p))))
          sftp.on('REMOVE', simple((p) => fs.unlinkSync(toLocal(p))))
          sftp.on('RENAME', simple((a, b) => fs.renameSync(toLocal(a), toLocal(b))))
          sftp.on('SETSTAT', simple((p, a) => a.mode != null && fs.chmodSync(toLocal(p), a.mode & 0o7777)))
          sftp.on('FSETSTAT', simple((h, a) => a.mode != null && fs.fchmodSync(get(h).fd, a.mode & 0o7777)))
        })
      })
    })
    .on('error', () => undefined)
}).listen(PORT, '127.0.0.1', function () {
  const pub = utils.parseKey(hostKey).getPublicSSH()
  const fp = 'SHA256:' + createHash('sha256').update(pub).digest('base64').replace(/=+$/, '')
  console.log(`SFTP test server on 127.0.0.1:${this.address().port}`)
  console.log(`  root: ${ROOT}  (client "/" maps here)`)
  console.log(`  login: ${USER} / ${PASS}`)
  console.log(`  host key: ED25519 ${fp}`)
  console.log(`  toClient example: ${toClient(join(ROOT, 'var/www'))}`)
})
