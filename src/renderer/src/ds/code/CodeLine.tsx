import { memo } from 'react'
import { tokenize, type Lang } from './tokenize'

/** One syntax-highlighted line using the bundle's `tk-*` classes. */
export const CodeLine = memo(function CodeLine({ text, lang }: { text: string; lang: Lang }) {
  if (!text) return null
  // Long minified lines: skip highlighting.
  if (text.length > 2000) return <>{text}</>
  return (
    <>
      {tokenize(text, lang).map((tk, i) => {
        const cls = tk.t === 'id' || tk.t === 'op' || tk.t === 'ws' ? null : `tk-${tk.t}`
        return cls ? (
          <span key={i} className={cls}>
            {tk.v}
          </span>
        ) : (
          tk.v
        )
      })}
    </>
  )
})
