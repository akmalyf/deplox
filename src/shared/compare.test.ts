import { describe, expect, it } from 'vitest'
import { buildRows, groupHunks, joinText, mergeDetailed, mergeForLocal, mergeForRemote, splitText } from './compare'

const L = (s: string) => splitText(s).lines

describe('splitText / joinText', () => {
  it('detects CRLF, BOM and trailing newline', () => {
    const s = splitText('\uFEFFa\r\nb\r\n')
    expect(s).toEqual({ lines: ['a', 'b'], eol: '\r\n', bom: true, trailingNewline: true })
    expect(joinText(s.lines, { ...s, exists: true })).toBe('\uFEFFa\r\nb\r\n')
  })
  it('handles missing trailing newline and empty file', () => {
    expect(splitText('a\nb')).toMatchObject({ lines: ['a', 'b'], trailingNewline: false })
    expect(splitText('')).toMatchObject({ lines: [], trailingNewline: false })
    expect(joinText(['x'], { eol: '\n', bom: false, trailingNewline: false, exists: true, text: '' })).toBe('x\n')
  })
})

describe('buildRows', () => {
  it('identical files have no hunks', () => {
    const rows = buildRows(L('a\nb\nc\n'), L('a\nb\nc\n'))
    expect(rows.every((r) => r.kind === '')).toBe(true)
    expect(groupHunks(rows)).toEqual([])
  })

  it('classifies add, del and mod', () => {
    const local = L('a\nNEW\nb\nc2\nd\n')
    const remote = L('a\nb\nc\nd\nGONE\n')
    const rows = buildRows(local, remote)
    expect(rows.map((r) => r.kind)).toEqual(['', 'add', '', 'mod', '', 'del'])
    expect(groupHunks(rows).map((h) => h.id)).toEqual([1, 2, 3])
    const mod = rows[3]
    expect(mod).toMatchObject({ localText: 'c2', remoteText: 'c', localNo: 4, remoteNo: 3 })
  })

  it('pads uneven replacements inside one hunk (mockup case)', () => {
    const local = L('{\n  $dev = 1;\n\n  if ($dev) {}\n}\n')
    const remote = L('{\n  return 1;\n}\n')
    const rows = buildRows(local, remote)
    const changed = rows.filter((r) => r.kind)
    expect(changed.every((r) => r.kind === 'mod' && r.hunkId === 1)).toBe(true)
    expect(changed.filter((r) => r.remoteNo === null).length).toBe(2)
    expect(changed[0].hunkStart).toBe(true)
  })

  it('ignoreWhitespace keeps each side text', () => {
    const rows = buildRows(L('  a\nb\n'), L('a\nb\n'), { ignoreWhitespace: true })
    expect(rows.map((r) => r.kind)).toEqual(['', ''])
    expect(rows[0].localText).toBe('  a')
    expect(rows[0].remoteText).toBe('a')
  })

  it('handles empty sides', () => {
    expect(buildRows([], L('a\n')).map((r) => r.kind)).toEqual(['del'])
    expect(buildRows(L('a\n'), []).map((r) => r.kind)).toEqual(['add'])
    expect(buildRows([], [])).toEqual([])
  })
})

describe('merge', () => {
  const local = L('a\nNEW\nb\nc2\nd\n')
  const remote = L('a\nb\nc\nd\nGONE\n')
  const rows = buildRows(local, remote)
  const all = new Set(rows.filter((r) => r.kind).map((r) => r.id))

  it('select none returns the target unchanged', () => {
    expect(mergeForRemote(rows, new Set())).toEqual(remote)
    expect(mergeForLocal(rows, new Set())).toEqual(local)
  })
  it('select all returns the other side', () => {
    expect(mergeForRemote(rows, all)).toEqual(local)
    expect(mergeForLocal(rows, all)).toEqual(remote)
  })
  it('partial selection applies only chosen rows', () => {
    const onlyMod = new Set([rows[3].id])
    expect(mergeForRemote(rows, onlyMod)).toEqual(['a', 'b', 'c2', 'd', 'GONE'])
    const onlyDel = new Set([rows[5].id])
    expect(mergeForRemote(rows, onlyDel)).toEqual(['a', 'b', 'c', 'd'])
    expect(mergeDetailed(rows, onlyMod, 'remote').filter((l) => l.fromOther).map((l) => l.text)).toEqual(['c2'])
  })
  it('CRLF target keeps its EOL', () => {
    const t = splitText('x\r\ny\r\n')
    const r = buildRows(L('x\nz\n'), t.lines)
    const sel = new Set(r.filter((x) => x.kind).map((x) => x.id))
    expect(joinText(mergeForRemote(r, sel), { ...t, exists: true })).toBe('x\r\nz\r\n')
  })
})
