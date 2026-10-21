import { useMemo, useRef, type MouseEvent, type ReactNode } from 'react'
import { Icon } from './Icon'
import { cx } from './cx'

export type FileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'conflict'

export interface FileNode {
  name: string
  /** Unique key, usually the absolute path. */
  path: string
  type?: 'folder' | 'file'
  children?: FileNode[]
  open?: boolean
  loading?: boolean
  icon?: string
  status?: FileStatus
  badge?: ReactNode
  dim?: boolean
  title?: string
}

const EXT_ICON: Record<string, string> = {
  php: 'file-code', js: 'file-code', mjs: 'file-code', cjs: 'file-code', ts: 'file-code', tsx: 'file-code', jsx: 'file-code', css: 'file-code',
  scss: 'file-code', html: 'file-code', vue: 'file-code', py: 'file-code', rb: 'file-code', go: 'file-code', sh: 'file-code', blade: 'file-code',
  json: 'file-json', yml: 'file-json', yaml: 'file-json', xml: 'file-json', toml: 'file-json',
  md: 'file-text', txt: 'file-text', log: 'file-text', csv: 'file-text',
  png: 'file-image', jpg: 'file-image', jpeg: 'file-image', svg: 'file-image', gif: 'file-image', webp: 'file-image', ico: 'file-image',
  env: 'file-lock', lock: 'file-lock', pem: 'file-lock', key: 'file-lock', htaccess: 'file-lock'
}

export function fileIcon(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name)
  const ext = m ? m[1].toLowerCase() : name.charAt(0) === '.' ? name.slice(1).toLowerCase() : ''
  return EXT_ICON[ext] ?? 'file'
}

const STATUS_LETTER: Record<FileStatus, string> = { modified: 'M', added: 'A', deleted: 'D', untracked: 'U', conflict: '!' }

export interface FileTreeProps {
  nodes: FileNode[]
  fileIcons?: 'plain' | 'typed'
  label?: string
  selected?: ReadonlySet<string>
  /** Path of the row with keyboard focus. */
  focused?: string | null
  width?: number | string
  onSelect?: (path: string, node: FileNode, e: { shift: boolean; meta: boolean }) => void
  onToggle?: (path: string, node: FileNode, open: boolean) => void
  onOpen?: (path: string, node: FileNode) => void
  onContextMenu?: (path: string, node: FileNode, e: MouseEvent) => void
  empty?: ReactNode
  className?: string
}

interface Row {
  node: FileNode
  depth: number
  folder: boolean
  open: boolean
}

function flatten(nodes: FileNode[], depth: number, out: Row[]): Row[] {
  for (const node of nodes) {
    const folder = node.type === 'folder' || !!node.children
    const open = folder && !!node.open
    out.push({ node, depth, folder, open })
    if (open && node.children) flatten(node.children, depth + 1, out)
  }
  return out
}

export function FileTree({ nodes, fileIcons = 'typed', label, selected, focused, width, onSelect, onToggle, onOpen, onContextMenu, empty, className }: FileTreeProps) {
  const rows = useMemo(() => flatten(nodes, 0, []), [nodes])
  const ref = useRef<HTMLDivElement>(null)

  const focusIndex = focused ? rows.findIndex((r) => r.node.path === focused) : -1

  const move = (idx: number, shift: boolean) => {
    const r = rows[Math.max(0, Math.min(rows.length - 1, idx))]
    if (!r) return
    onSelect?.(r.node.path, r.node, { shift, meta: false })
    const el = ref.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(r.node.path)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div
      ref={ref}
      className={cx('ad-tree', className)}
      role="tree"
      aria-label={label || 'Files'}
      aria-multiselectable="true"
      tabIndex={0}
      style={width != null ? { width } : undefined}
      onKeyDown={(e) => {
        if (!rows.length) return
        const cur = focusIndex >= 0 ? rows[focusIndex] : null
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          move(focusIndex + 1, e.shiftKey)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          move(focusIndex <= 0 ? 0 : focusIndex - 1, e.shiftKey)
        } else if (e.key === 'ArrowRight' && cur?.folder) {
          e.preventDefault()
          if (!cur.open) onToggle?.(cur.node.path, cur.node, true)
          else move(focusIndex + 1, false)
        } else if (e.key === 'ArrowLeft' && cur) {
          e.preventDefault()
          if (cur.folder && cur.open) onToggle?.(cur.node.path, cur.node, false)
          else {
            for (let i = focusIndex - 1; i >= 0; i--) if (rows[i].depth < cur.depth) return move(i, false)
          }
        } else if (e.key === 'Enter' && cur) {
          e.preventDefault()
          if (cur.folder) onToggle?.(cur.node.path, cur.node, !cur.open)
          else onOpen?.(cur.node.path, cur.node)
        }
      }}
    >
      {rows.length === 0 ? empty : null}
      {rows.map(({ node, depth, folder, open }) => {
        const isSel = !!selected?.has(node.path)
        const guides = []
        for (let d = 0; d < depth; d++) guides.push(<span key={d} className="ad-tree-guide" style={{ left: `${12 + d * 16}px` }} />)
        return (
          <div
            key={node.path}
            data-path={node.path}
            role="treeitem"
            aria-expanded={folder ? (open ? 'true' : 'false') : undefined}
            aria-selected={isSel ? 'true' : 'false'}
            aria-level={depth + 1}
            title={node.title}
            className={cx('ad-tree-row', isSel && 'ad-tree-row-selected', node.status && `ad-tree-row-${node.status}`)}
            style={{ paddingLeft: `${8 + depth * 16}px`, opacity: node.dim ? 0.55 : undefined }}
            onMouseDown={(e) => {
              if (e.detail > 1) e.preventDefault()
            }}
            onClick={(e) => {
              onSelect?.(node.path, node, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })
              const onChevron = (e.target as HTMLElement).closest('.ad-tree-chevron')
              if (folder && (onChevron || (!e.shiftKey && !e.metaKey && !e.ctrlKey))) onToggle?.(node.path, node, !open)
            }}
            onDoubleClick={() => {
              if (!folder) onOpen?.(node.path, node)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              onContextMenu?.(node.path, node, e)
            }}
          >
            {guides}
            <span className={cx('ad-tree-chevron', open && 'ad-tree-chevron-open')} aria-hidden="true">
              {folder ? node.loading ? <Icon name="spinner" size={12} className="spin" /> : <Icon name="chevron-right" size={12} /> : null}
            </span>
            <Icon name={node.icon || (folder ? (open ? 'folder-open' : 'folder') : fileIcons === 'typed' ? fileIcon(node.name) : 'file')} className="ad-tree-icon" />
            <span className="ad-tree-name">{node.name}</span>
            {node.badge != null ? <span className="ad-tree-badge">{node.badge}</span> : null}
            {node.status ? (
              <span className="ad-tree-status" aria-label={node.status}>
                {STATUS_LETTER[node.status]}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
