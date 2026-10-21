# Deplox

FTP/SFTP remote-host client in the spirit of JetBrains *Deployment*: browse local and remote side by side, upload and download files and folders, compare a local file with its server copy and move changes **line by line**, run SSH and local terminals, and keep a sync queue of pending changes.

Electron 44 · electron-vite 6 · React 19 · TypeScript 7 · ssh2 · basic-ftp · node-pty · xterm.js. UI follows the *Agent Desktop* design system (tokens and `ad-*` styles vendored in `src/renderer/src/styles`, components ported to TSX in `src/renderer/src/ds`).

## Features

- **Hosts per project**: SFTP (password, key pair, ssh-agent), FTP and FTPS (passive), path mappings, excluded patterns (gitignore-style), secrets in the OS keychain (`safeStorage`), host-key verification with a known-hosts store.
- **Remote Browser**: two lazy-loading trees with differs / local-only / remote-only / conflict markers, synced expand and scroll, filters, context menus, new folder, rename, delete (local goes to Trash).
- **Transfers**: queue with per-host concurrency, folder recursion, progress and speed, pause/resume (byte offset), cancel, retry, log. Paused automatically when a connection drops and resumed after reconnect.
- **Compare**: side-by-side diff, per-line checkboxes, per-hunk » upload / « take, result preview, ignore whitespace, keeps EOL/BOM/trailing newline, refuses to overwrite a file that changed since it was loaded.
- **Terminals**: SSH shells over the host's connection and local shells (node-pty), tabs, snippets, session info, flow control.
- **Sync Queue**: file watcher + rescan of both sides against a last-synced snapshot, conflicts routed to Compare, upload on save, run confirmation listing deletes.
- Command palette (⌘K), ⌘1–4 views, ⌥⌘↑/↓ upload/download, ⌘D compare, dark/light/system theme.

## Develop

```bash
pnpm install
pnpm dev            # app with hot reload
pnpm typecheck
pnpm test           # unit tests (diff/merge, excludes, path mapping)
```

Try it against the bundled test server (no Docker needed):

```bash
pnpm dev:seed       # dev/local-project + a diverged dev/remote/var/www/app
pnpm dev:server     # SFTP + SSH on 127.0.0.1:2222, login deploy / pass
pnpm test:int       # SftpFs integration tests against that server
```

Create a project for `dev/local-project`, add host `127.0.0.1:2222` (password `pass`), deployment path `/var/www/app`.

`dev/docker-compose.yml` has optional third-party SFTP/FTP containers. `node dev/cdp.mjs` drives a running app over the DevTools protocol (`electron . --remote-debugging-port=9333`); set `DEPLOX_USER_DATA` to use a throwaway profile.

## Package

```bash
pnpm dist
```

## Layout

```
src/shared     pure TS: types, IPC contract, diff/merge, excludes, path mapping
src/main       store + secrets, RemoteFs (SftpFs, FtpFs), ConnectionManager, TransferQueue, terminals, sync engine, IPC handlers
src/preload    typed window.deplox bridge (channel allow-list)
src/renderer   React views, zustand stores, ported design system
```
