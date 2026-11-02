// 단어 목록의 거르기·정렬 ↔ 주소(?…) ↔ WordsQuery. 단어 화면의 「N개 연습」이 /drill?from=words&… 로 넘기고,
// 연습 화면이 같은 주소를 같은 목록으로 되돌릴 때 parseWordsParams 를 쓴다.
import type { Level, Pos, WordsQuery } from '../shared/api.ts'

export type SortKey = NonNullable<WordsQuery['sort']>

export interface WordsFilter {
  q: string
  state: NonNullable<WordsQuery['state']>
  level: Level | 'all'
  pos: Pos | 'all'
  image: 'all' | 'yes' | 'no'
  weak: boolean
  week: boolean
  sort: SortKey
}

export const EMPTY_FILTER: WordsFilter = { q: '', state: 'all', level: 'all', pos: 'all', image: 'all', weak: false, week: false, sort: 'seq' }

/** 서버에 보낼 질의. 자주 틀림만 켜고 정렬을 안 골랐으면 많이 틀린 순으로 */
export function toQuery(f: WordsFilter): WordsQuery {
  const sort = f.weak && f.sort === 'seq' ? 'weak' : f.sort
  return {
    q: f.q.trim() || undefined,
    state: f.state === 'all' ? undefined : f.state,
    level: f.level === 'all' ? undefined : f.level,
    pos: f.pos === 'all' ? undefined : f.pos,
    image: f.image === 'all' ? undefined : f.image,
    weak: f.weak ? 1 : undefined,
    week: f.week ? 1 : undefined,
    sort: sort === 'seq' ? undefined : sort,
  }
}

/** 연습 화면 주소(/drill?…). n = 연습할 장 수 */
export function practiceParams(f: WordsFilter, n: number): string {
  const p = new URLSearchParams({ from: 'words', n: String(n) })
  for (const [k, v] of Object.entries(toQuery(f))) if (v !== undefined) p.set(k, String(v))
  return p.toString()
}

/** practiceParams 의 반대 — 연습 화면이 같은 목록을 다시 불러올 때 */
export function parseWordsParams(q: URLSearchParams): WordsQuery {
  const g = (k: string) => q.get(k) || undefined
  return {
    q: g('q'),
    state: g('state') as WordsQuery['state'],
    level: g('level') as WordsQuery['level'],
    pos: g('pos') as WordsQuery['pos'],
    image: g('image') as WordsQuery['image'],
    weak: q.get('weak') === '1' ? 1 : undefined,
    week: q.get('week') === '1' ? 1 : undefined,
    sort: g('sort') as WordsQuery['sort'],
  }
}
