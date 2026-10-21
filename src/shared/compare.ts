import { diffLines } from 'diff'
import type { CompareSide } from './types'

export interface SplitText {
  lines: string[]
  eol: '\n' | '\r\n'
  bom: boolean
  trailingNewline: boolean
}

/** Split file content into lines, remembering BOM, EOL style and the trailing newline. */
export function splitText(raw: string): SplitText {
  let text = raw
  const bom = text.charCodeAt(0) === 0xfeff
  if (bom) text = text.slice(1)
  const firstBreak = text.indexOf('\n')
  const eol: '\n' | '\r\n' = firstBreak > 0 && text[firstBreak - 1] === '\r' ? '\r\n' : '\n'
  if (text === '') return { lines: [], eol, bom, trailingNewline: false }
  const lines = text.split(/\r\n|\n/)
  let trailingNewline = false
  if (lines[lines.length - 1] === '') {
    lines.pop()
    trailingNewline = true
  }
  return { lines, eol, bom, trailingNewline }
}

/** Join lines using the target file's EOL/BOM/trailing-newline conventions. */
export function joinText(lines: string[], side: Pick<CompareSide, 'eol' | 'bom' | 'trailingNewline' | 'exists'> & { text?: string }): string {
  // An empty or missing target gets a trailing newline once it has content.
  const trailing = side.trailingNewline || !side.exists || side.text === ''
  return (side.bom ? '﻿' : '') + lines.join(side.eol) + (lines.length && trailing ? side.eol : '')
}

/** '' unchanged · 'add' local only · 'mod' both sides differ · 'del' remote only */
export type RowKind = '' | 'add' | 'mod' | 'del'

export interface DiffRow {
  id: string
  index: number
  localNo: number | null
  localText: string
  remoteNo: number | null
  remoteText: string
  kind: RowKind
  hunkId: number | null
  hunkStart: boolean
}

export interface Hunk {
  id: number
  start: number
  end: number // inclusive row index
  rowIds: string[]
}

interface Change {
  value: string
  count?: number
  added?: boolean
  removed?: boolean
}

function countLines(c: Change): number {
  if (typeof c.count === 'number') return c.count
  const parts = c.value.split('\n')
  return parts[parts.length - 1] === '' ? parts.length - 1 : parts.length
}

function toDiffInput(lines: string[]): string {
  return lines.length ? lines.join('\n') + '\n' : ''
}

/**
 * Align local and remote lines into side-by-side rows.
 * jsdiff runs remote → local: `removed` = remote only, `added` = local only.
 */
export function buildRows(localLines: string[], remoteLines: string[], opts: { ignoreWhitespace?: boolean } = {}): DiffRow[] {
  const changes = diffLines(toDiffInput(remoteLines), toDiffInput(localLines), {
    ignoreWhitespace: !!opts.ignoreWhitespace
  }) as Change[]

  const rows: Omit<DiffRow, 'id' | 'index' | 'hunkId' | 'hunkStart'>[] = []
  let li = 0
  let ri = 0

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]
    const n = countLines(c)
    if (!c.added && !c.removed) {
      for (let k = 0; k < n; k++) {
        rows.push({ kind: '', localNo: li + 1, localText: localLines[li] ?? '', remoteNo: ri + 1, remoteText: remoteLines[ri] ?? '' })
        li++
        ri++
      }
      continue
    }
    const next = changes[i + 1]
    const paired = next && ((c.removed && next.added) || (c.added && next.removed))
    if (paired) {
      const rem = c.removed ? n : countLines(next)
      const add = c.added ? n : countLines(next)
      const total = Math.max(rem, add)
      for (let k = 0; k < total; k++) {
        const hasL = k < add
        const hasR = k < rem
        rows.push({
          kind: 'mod',
          localNo: hasL ? li + 1 : null,
          localText: hasL ? localLines[li] ?? '' : '',
          remoteNo: hasR ? ri + 1 : null,
          remoteText: hasR ? remoteLines[ri] ?? '' : ''
        })
        if (hasL) li++
        if (hasR) ri++
      }
      i++
      continue
    }
    if (c.removed) {
      for (let k = 0; k < n; k++) {
        rows.push({ kind: 'del', localNo: null, localText: '', remoteNo: ri + 1, remoteText: remoteLines[ri] ?? '' })
        ri++
      }
    } else {
      for (let k = 0; k < n; k++) {
        rows.push({ kind: 'add', localNo: li + 1, localText: localLines[li] ?? '', remoteNo: null, remoteText: '' })
        li++
      }
    }
  }

  // Safety net: if jsdiff counts ever drift, append whatever is left so no line is lost.
  while (li < localLines.length || ri < remoteLines.length) {
    const hasL = li < localLines.length
    const hasR = ri < remoteLines.length
    rows.push({
      kind: hasL && hasR ? 'mod' : hasL ? 'add' : 'del',
      localNo: hasL ? li + 1 : null,
      localText: hasL ? localLines[li] : '',
      remoteNo: hasR ? ri + 1 : null,
      remoteText: hasR ? remoteLines[ri] : ''
    })
    if (hasL) li++
    if (hasR) ri++
  }

  let hunk = 0
  return rows.map((r, index) => {
    const prev = index > 0 ? rows[index - 1] : null
    const start = r.kind !== '' && (!prev || prev.kind === '')
    if (start) hunk++
    return { ...r, id: 'r' + index, index, hunkId: r.kind ? hunk : null, hunkStart: start }
  })
}

export function groupHunks(rows: DiffRow[]): Hunk[] {
  const out: Hunk[] = []
  for (const r of rows) {
    if (r.hunkId === null) continue
    const last = out[out.length - 1]
    if (last && last.id === r.hunkId) {
      last.end = r.index
      last.rowIds.push(r.id)
    } else out.push({ id: r.hunkId, start: r.index, end: r.index, rowIds: [r.id] })
  }
  return out
}

export interface MergedLine {
  text: string
  /** True when the line came from the other side (selected change). */
  fromOther: boolean
}

/**
 * Build the content of `target` after applying the selected rows from the other side.
 * Unselected and unchanged rows keep the target's own text. A selected row whose
 * source side is empty deletes the target line.
 */
export function mergeDetailed(rows: DiffRow[], selected: ReadonlySet<string>, target: 'remote' | 'local'): MergedLine[] {
  const out: MergedLine[] = []
  for (const r of rows) {
    const ownNo = target === 'remote' ? r.remoteNo : r.localNo
    const ownText = target === 'remote' ? r.remoteText : r.localText
    const srcNo = target === 'remote' ? r.localNo : r.remoteNo
    const srcText = target === 'remote' ? r.localText : r.remoteText
    if (r.kind === '') {
      out.push({ text: ownText, fromOther: false })
    } else if (selected.has(r.id)) {
      if (srcNo !== null) out.push({ text: srcText, fromOther: true })
    } else if (ownNo !== null) {
      out.push({ text: ownText, fromOther: false })
    }
  }
  return out
}

export function mergeForRemote(rows: DiffRow[], selected: ReadonlySet<string>): string[] {
  return mergeDetailed(rows, selected, 'remote').map((l) => l.text)
}

export function mergeForLocal(rows: DiffRow[], selected: ReadonlySet<string>): string[] {
  return mergeDetailed(rows, selected, 'local').map((l) => l.text)
}

/** True when the buffer looks binary (NUL byte in the first 8 KB). */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192)
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true
  return false
}

export function languageOf(path: string): 'php' | 'js' | 'css' | 'json' {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''
  if (ext === 'json') return 'json'
  if (ext === 'css' || ext === 'scss' || ext === 'less') return 'css'
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue'].includes(ext)) return 'js'
  return 'php'
}
