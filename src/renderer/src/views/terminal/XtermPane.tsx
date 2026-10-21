import { useEffect, useRef } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { terminalBus } from '../../stores/terminal'
import { useApp } from '../../stores/app'
import { invoke } from '../../lib/ipc'

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function themeFromTokens(): ITheme {
  const dark = document.documentElement.dataset.theme !== 'light'
  return {
    background: cssVar('--bg-pane') || cssVar('--bg-raised'),
    foreground: cssVar('--ink'),
    cursor: cssVar('--ink'),
    cursorAccent: cssVar('--bg-raised'),
    selectionBackground: dark ? 'rgba(105, 155, 225, 0.35)' : 'rgba(47, 103, 196, 0.25)',
    black: dark ? '#2a2a30' : '#141414',
    red: cssVar('--danger'),
    green: cssVar('--success-text'),
    yellow: cssVar('--warning'),
    blue: cssVar('--accent'),
    magenta: cssVar('--code-variable'),
    cyan: cssVar('--code-number'),
    white: dark ? '#d4d4d6' : '#4b4b4b',
    brightBlack: cssVar('--ink-subtle'),
    brightRed: dark ? '#ff8a80' : '#c62828',
    brightGreen: dark ? '#9fe0ad' : '#2e7d32',
    brightYellow: dark ? '#f5d29a' : '#a0661a',
    brightBlue: dark ? '#8ab8f2' : '#1e4fa3',
    brightMagenta: dark ? '#d9a3d5' : '#6a1b7a',
    brightCyan: dark ? '#7fc4cf' : '#00838f',
    brightWhite: dark ? '#ffffff' : '#141414'
  }
}

export function XtermPane({ sessionId, active }: { sessionId: string; active: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const settings = useApp((s) => s.settings)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const t = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace',
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      scrollback: 10_000,
      allowProposedApi: false,
      macOptionIsMeta: true,
      theme: themeFromTokens()
    })
    const f = new FitAddon()
    t.loadAddon(f)
    t.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, '_blank')))
    t.open(el)
    term.current = t
    fit.current = f

    let pendingAck = 0
    let ackTimer: ReturnType<typeof setTimeout> | null = null
    const flushAck = () => {
      ackTimer = null
      if (pendingAck) window.deplox.send('terminal:ack', { sessionId, bytes: pendingAck })
      pendingAck = 0
    }
    const unsub = terminalBus.subscribe(sessionId, (chunk) => {
      t.write(chunk, () => {
        pendingAck += chunk.byteLength
        if (pendingAck >= 64 * 1024) flushAck()
        else if (!ackTimer) ackTimer = setTimeout(flushAck, 100)
      })
    })
    const d1 = t.onData((data) => window.deplox.send('terminal:write', { sessionId, data }))
    const d2 = t.onBinary((data) => window.deplox.send('terminal:write', { sessionId, data }))
    const d3 = t.onSelectionChange(() => {
      const s = t.getSelection()
      if (s) void invoke('app:copyText', s)
    })

    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const doFit = () => {
      if (!el.offsetWidth || !el.offsetHeight) return
      try {
        f.fit()
        window.deplox.send('terminal:resize', { sessionId, cols: t.cols, rows: t.rows })
      } catch {
        /* not visible yet */
      }
    }
    const ro = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(doFit, 50)
    })
    ro.observe(el)
    doFit()

    return () => {
      ro.disconnect()
      unsub()
      d1.dispose()
      d2.dispose()
      d3.dispose()
      if (ackTimer) clearTimeout(ackTimer)
      flushAck()
      t.dispose()
      term.current = null
    }
  }, [sessionId])

  useEffect(() => {
    // Recolor after theme switches (tokens change on <html data-theme>).
    const t = term.current
    if (t) requestAnimationFrame(() => (t.options.theme = themeFromTokens()))
  }, [settings.theme])

  useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => {
      try {
        fit.current?.fit()
        const t = term.current
        if (t) window.deplox.send('terminal:resize', { sessionId, cols: t.cols, rows: t.rows })
      } catch {
        /* ignore */
      }
      term.current?.focus()
    })
  }, [active, sessionId])

  return <div ref={host} className="xterm-host" style={{ display: active ? 'block' : 'none' }} data-session={sessionId} />
}
