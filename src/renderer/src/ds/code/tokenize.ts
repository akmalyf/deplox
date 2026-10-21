// Ported from the Agent Desktop bundle: a tiny line tokenizer for the six-colour syntax palette.
export type TokenType = 'cm' | 'str' | 'var' | 'this' | 'num' | 'kw' | 'fn' | 'id' | 'op' | 'ws'
export interface Token {
  t: TokenType
  v: string
}
export type Lang = 'php' | 'js' | 'css' | 'json'

const KW: Record<Lang, Set<string>> = {
  php: new Set(
    'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null'.split(' ')
  ),
  js: new Set(
    'async await break case catch class const continue debugger default delete do else enum export extends finally for from function if implements import in instanceof interface let new of package private protected public return static super switch this throw try typeof var void while with yield true false null undefined type'.split(' ')
  ),
  css: new Set(['important']),
  json: new Set(['true', 'false', 'null'])
}

const RE = /(\/\/.*$|#.*$|\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\$[A-Za-z_]\w*)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w\\]*)(?=\s*\()|([A-Za-z_][\w\\]*)|(->|=>|::|[^\sA-Za-z_$\d'"`]+|['"`])|(\s+)/g

export function tokenize(line: string, lang: Lang = 'php'): Token[] {
  const kw = KW[lang] ?? KW.php
  const out: Token[] = []
  RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE.exec(line))) {
    if (m[1]) {
      // `#` starts a comment only in php; in css it's a selector/colour.
      if (m[1].startsWith('#') && lang !== 'php') out.push({ t: 'op', v: m[1] })
      else out.push({ t: 'cm', v: m[1] })
    } else if (m[2]) out.push({ t: 'str', v: m[2] })
    else if (m[3]) out.push({ t: m[3] === '$this' ? 'this' : 'var', v: m[3] })
    else if (m[4]) out.push({ t: 'num', v: m[4] })
    else if (m[5]) out.push({ t: kw.has(m[5]) ? 'kw' : 'fn', v: m[5] })
    else if (m[6]) out.push({ t: kw.has(m[6]) ? (m[6] === 'this' ? 'this' : 'kw') : out.length && out[out.length - 1].v === '->' ? 'var' : 'id', v: m[6] })
    else if (m[7]) out.push({ t: 'op', v: m[7] })
    else if (m[8]) out.push({ t: 'ws', v: m[8] })
    if (m[0] === '') RE.lastIndex++
  }
  return out
}
