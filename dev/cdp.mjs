// Tiny Chrome DevTools Protocol client for poking at the running app.
//   node dev/cdp.mjs eval "<js expression>"
//   node dev/cdp.mjs shot out.png
//   node dev/cdp.mjs click "<css selector>"   |   type "<text>"   |   key Enter
const PORT = process.env.CDP_PORT ?? 9333
const [cmd, ...args] = process.argv.slice(2)
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d)
    pending.delete(d.id)
  }
}
await new Promise((r) => (ws.onopen = r))
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails))
  return r.result?.result?.value
}
if (cmd === 'eval') console.log(JSON.stringify(await evaluate(args.join(' ')), null, 2))
else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(args[0], Buffer.from(r.result.data, 'base64'))
  console.log('saved', args[0])
} else if (cmd === 'click') {
  const box = await evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(args[0])})].find(e => ${args[1] ? `e.textContent.trim().includes(${JSON.stringify(args[1])})` : 'true'}); if (!el) return null; el.scrollIntoView({block:'nearest'}); const r = el.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2} })()`)
  if (!box) throw new Error('not found: ' + args.join(' '))
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: Number(args[2] ?? 1) })
  console.log('clicked', args.join(' '))
} else if (cmd === 'type') {
  await send('Input.insertText', { text: args.join(' ') })
} else if (cmd === 'key') {
  const key = args[0]
  const mods = Number(args[1] ?? 0)
  const codes = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Tab: 9, Backspace: 8 }
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, windowsVirtualKeyCode: codes[key] ?? key.toUpperCase().charCodeAt(0), modifiers: mods, text: type === 'keyDown' && key.length === 1 ? key : undefined })
}
ws.close()
