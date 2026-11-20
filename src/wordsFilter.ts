// 단어 목록의 거르기·정렬 ↔ 주소(?…) ↔ WordsQuery. 단어 화면의 「N개 연습」이 /drill?from=words&… 로 넘기고,
// 연습 화면이 같은 주소를 같은 목록으로 되돌릴 때 parseWordsParams 를 쓴다.
import type { DeckItem, Level, Pos, WordsCountsResponse, WordsQuery } from '../shared/api.ts'
import { num } from './format.ts'

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

/**
 * 묶음 머리(v13 U5 · L5): 거르기 없는 「순서」 목록에서 배우는 중 → 다음 30일(하루 새 단어 × 30) → 1년 안 → 그 뒤.
 * 목록이 9,000개를 묶음 없이 한 줄로 보여 주던 것. 거르기·검색 중엔 머리를 안 단다
 */
export function withGroups(items: DeckItem[], on: boolean, counts: WordsCountsResponse | null): Array<{ it: DeckItem; head: string | null }> {
  const perDay = counts?.new_per_day ?? 5
  const next30 = perDay * 30
  // 배울 범위(v13 L5): 지금 속도로 1년 치(하루 새 단어 × 365)까지가 「앞으로 배울 단어」, 그 뒤는 참고용
  const next365 = perDay * 365
  let fresh = 0
  return items.map((it, i) => {
    if (!on) return { it, head: null }
    const learning = !(it.card.state === 0 && !it.card.introduced_at)
    let head: string | null = null
    if (learning && i === 0) head = `배우는 중${counts?.learning ? ` ${num(counts.learning)}개` : ''}`
    if (!learning) {
      if (fresh === 0) head = `다음 30일에 배울 단어 ${num(next30)}개`
      else if (fresh === next30) head = `1년 안에 배울 단어 ${num(next365 - next30)}개`
      else if (fresh === next365) head = '그 뒤 · 지금 속도로 1년 넘게 걸리는 단어'
      fresh++
    }
    return { it, head }
  })
}

