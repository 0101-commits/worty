// 오늘 몫 한 세션(기획 v11 5절 「카드 상태 → 연습」 표). React 없음 — 시험에서 바로 부른다.
// 줄(덱 리듀서 deck.ts)은 그대로 쓰고, 「지금 카드에 어떤 연습을 낼지」와 「연습 결과 → FSRS 채점」만 여기서 정한다.
//   새 단어          → 소개 카드(그림 · 예문) → 뜻 고르기           · 자동 채점
//   배우는 중(며칠)   → 빈칸 · 짝(배우는 카드 5개가 모이면)         · 자동 채점
//   복습(간격 짧음)   → 카드 뒤집기                                · X / O
//   복습(간격 김)     → 명사는 관사 고르기, 나머지는 쓰기            · 자동 채점
//   잊은 단어        → 소개 카드 다시 → 빈칸                       · 자동 채점
// 「듣고 고르기」는 앱에 소리(TTS)가 없어 아직 안 낸다.
import type { Card, DeckItem, PoolWord, PracticeMode, Rating, TodayResponse } from '../shared/api.ts'
import { firstUp } from './deck.ts'
import { dayDiff } from './format.ts'
import { MATCH_SIZE, clash, makeQuestion, matchOf, poolOf, type ChoiceQ, type MatchQ, type WriteQ } from './practice.ts'
import { T } from './text.ts'

export type Stage = 'new' | 'learning' | 'short' | 'long' | 'lapsed'
export type Kind = 'flip' | 'meaning' | 'cloze' | 'match' | 'write' | 'artikel'

/** 처음 배운 지 이만큼(일)이 안 된 복습 카드는 「배우는 중」으로 본다 */
export const FIRST_DAYS = 3
/** 복습 간격이 이 이상(일)이면 「간격 김」 — 쓰기 · 관사 */
export const LONG_DAYS = 21
/** 고르기 퀴즈: 이 시간 안에 힌트 없이 맞히면 좋음, 넘거나 힌트를 봤으면 어려움 */
export const CHOICE_MS = 8_000
/** 쓰기는 손으로 치는 시간이 있어 더 길게 */
export const WRITE_MS = 20_000
/** 카드 뒤집기 X · O → FSRS 채점(R2 결정: 버튼 둘). X = 다시(1), O = 좋음(3) */
export const OX_RATING = { x: 1, o: 3 } as const satisfies Record<'x' | 'o', Rating>
/** 「+10개」 한 번에 낼 카드 수 */
export const MORE_N = 10

const DAY_MS = 86_400_000
const ARTICLES = ['der', 'die', 'das']

/** 카드 상태 → 세션 단계 */
export function stageOf(card: Card, now: Date = new Date()): Stage {
  if (card.state === 0) return 'new'
  if (card.state === 3) return 'lapsed'
  if (card.state === 1) return 'learning'
  const since = card.introduced_at ? now.getTime() - Date.parse(card.introduced_at) : Infinity
  if (since < FIRST_DAYS * DAY_MS) return 'learning'
  return card.scheduled_days >= LONG_DAYS ? 'long' : 'short'
}

/** 오늘 화면 단계 칩: 복습(간격 짧음·김) · 새 단어 · 퀴즈(배우는 중 · 잊은 단어) */
export function todayCounts(t: Pick<TodayResponse, 'due' | 'fresh'>, now: Date = new Date()) {
  let review = 0
  let quiz = 0
  for (const it of t.due) {
    const s = stageOf(it.card, now)
    if (s === 'short' || s === 'long') review++
    else quiz++
  }
  return { review, fresh: t.fresh.length, quiz }
}

/**
 * 세션 줄: 칩 차례대로 복습 → 새 단어 → 퀴즈(같은 무리 안에서는 서버 차례 = 잊어 가는 카드 먼저).
 * 배우는 카드가 뒤에 모여 있어 짝 맞추기 5개가 잘 모이고, 새 단어를 채점하면 그 카드가 퀴즈 무리 사이로 다시 들어간다.
 * first(아침 알림 빈칸 정답 카드)는 맨 앞.
 */
export function orderToday(t: Pick<TodayResponse, 'due' | 'fresh'>, first: string | null = null, now: Date = new Date()): DeckItem[] {
  const rank = (it: DeckItem) => {
    const s = stageOf(it.card, now)
    return s === 'short' || s === 'long' ? 0 : s === 'new' ? 1 : 2
  }
  const sorted = [...t.due, ...t.fresh]
    .map((it, i) => ({ it, i, r: rank(it) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.it)
  return firstUp(sorted, first)
}

/** 보기 재료 = 서버 보기 재료 + 세션 카드 단어(같은 id 는 한 번) */
export function mergePool(pool: PoolWord[], items: DeckItem[]): PoolWord[] {
  const seen = new Set(pool.map((p) => p.id))
  return [...pool, ...items.filter((it) => !seen.has(it.word.id) && it.word.gloss_ko).map((it) => poolOf(it.word))]
}

/** 관사 고르기를 낼 수 있는 명사(관사가 하나로 정해진 것) */
export const artikelOk = (w: DeckItem['word']) => w.pos === 'noun' && !!w.gender && ARTICLES.includes(w.gender)

export interface Step {
  kind: Kind
  /** 소개 카드를 먼저 보여 준다(새 단어 · 잊은 단어). 소개 카드는 채점하지 않는다 */
  intro: boolean
  /** 이 단계에서 채점할 카드(짝 맞추기 = 5장, 나머지 = 1장). items[0] = 지금 카드 */
  items: DeckItem[]
  q: ChoiceQ | MatchQ | WriteQ | null
}

export interface PlanCtx {
  pool: PoolWord[]
  /** 이 세션에서 이미 본 카드(덱 reshows) — 짝 맞추기로 앞당겨 오지 않는다(다시 보기 간격을 지키려고) */
  seen?: Record<string, number>
  /** 바로 앞 단계 — 짝 맞추기를 두 번 잇달아 내지 않는다 */
  lastKind?: Kind | null
  /** 「+10개」 연습: 뒤집기 · 관사 · 소개 없이 퀴즈만(결과는 연습 기록 /api/practice) */
  practice?: boolean
  now?: Date
  rand?: () => number
}

/**
 * 짝 맞추기 묶음: 지금 카드 + 줄 앞쪽의 「배우는 중」 카드(이 세션에서 아직 안 본 것 · 뜻 있음 · 서로 안 겹침)로 정확히 5장.
 * 모자라면 null(그때는 빈칸).
 */
function matchGroup(queue: DeckItem[], index: number, ctx: PlanCtx, now: Date): DeckItem[] | null {
  const ok = (it: DeckItem) => stageOf(it.card, now) === 'learning' && !!it.word.gloss_ko
  const head = queue[index]
  if (!head || !ok(head)) return null
  const group = [head]
  for (let i = index + 1; i < queue.length && group.length < MATCH_SIZE; i++) {
    const it = queue[i]
    if (ctx.seen?.[it.word.id] || !ok(it) || group.some((o) => clash(o.word, it.word))) continue
    group.push(it)
  }
  return group.length === MATCH_SIZE ? group : null
}

/** 지금 카드(queue[index])의 단계. 줄이 끝났으면 null */
export function planStep(queue: DeckItem[], index: number, ctx: PlanCtx): Step | null {
  const item = queue[index]
  if (!item) return null
  const now = ctx.now ?? new Date()
  const rand = ctx.rand ?? Math.random
  const practice = !!ctx.practice
  const one = (kind: Kind, q: Step['q'], intro = false): Step => ({ kind, intro, items: [item], q })
  const quiz = (modes: Array<'cloze' | 'meaning'>, intro: boolean) => {
    for (const m of modes) {
      const q = makeQuestion(m, item, ctx.pool, rand)
      if (q) return one(m, q, intro && !practice)
    }
    return null
  }
  const write = () => (item.word.gloss_ko ? one('write', { mode: 'write', item }) : null)
  const flip = () => one('flip', null)
  switch (stageOf(item.card, now)) {
    case 'new':
      return quiz(['meaning', 'cloze'], true) ?? (practice ? write() : null) ?? flip()
    case 'lapsed':
      return quiz(['cloze', 'meaning'], true) ?? (practice ? write() : null) ?? flip()
    case 'learning': {
      if (ctx.lastKind !== 'match') {
        const g = matchGroup(queue, index, ctx, now)
        if (g) return { kind: 'match', intro: false, items: g, q: matchOf(g, rand) }
      }
      return quiz(['cloze', 'meaning'], false) ?? (practice ? write() : null) ?? flip()
    }
    case 'short':
      return practice ? (quiz(['meaning', 'cloze'], false) ?? write() ?? flip()) : flip()
    case 'long':
      if (!practice && artikelOk(item.word)) return one('artikel', null)
      return write() ?? flip()
  }
}

/**
 * 고르기 · 쓰기 퀴즈 결과 → FSRS 채점(R2 결정: 맞힌 속도로 「어려움」을 자동 반영).
 * 틀림 = 다시(1) · 시간 안에 힌트 없이 맞힘 = 좋음(3) · 늦게 맞히거나 힌트를 봄 = 어려움(2)
 */
export function autoGrade(a: { correct: boolean; ms: number; hint?: boolean }, limit: number = CHOICE_MS): Rating {
  if (!a.correct) return 1
  return a.hint || a.ms > limit ? 2 : 3
}
export const limitFor = (kind: Kind) => (kind === 'write' ? WRITE_MS : CHOICE_MS)

/** O · X 셈: 맞힘 = 어려움 · 좋음 · 쉬움(2~4), 틀림 = 다시(1) */
export function oxCount(ratings: Array<{ rating: Rating }>) {
  const x = ratings.filter((r) => r.rating === 1).length
  return { o: ratings.length - x, x }
}

/** 「+10개」 연습 결과를 적을 방식(연습 기록 표 practice.mode). 뒤집기 · 관사는 안 적는다 */
export function practiceMode(kind: Kind): PracticeMode | null {
  return kind === 'cloze' || kind === 'meaning' || kind === 'write' || kind === 'match' ? kind : null
}

/** 카드 표지(싸다보카처럼 상태를 말로): 새 단어 · 다시 · 오늘 또 · 6일 만 · 2개월 만. tone = 색 */
export function sinceLabel(card: Card, now: Date = new Date()): { text: string; tone: 'new' | 'again' | 'plain' } {
  if (card.state === 0 || !card.last_review) return { text: T.sinceNew, tone: 'new' }
  if (card.state === 3) return { text: T.sinceAgain, tone: 'again' }
  const d = -dayDiff(card.last_review, now)
  if (d <= 0) return { text: T.sinceToday, tone: 'plain' }
  if (d >= 30) return { text: T.sinceMonths(Math.floor(d / 30)), tone: 'again' }
  return { text: T.sinceDays(d), tone: d >= 7 ? 'again' : 'plain' }
}

/** 한 장 ≈ 6초(알림 「약 N분」과 같은 셈 — worker/discord.ts minutesFor) */
export const minutesFor = (n: number) => Math.max(1, Math.ceil((n * 6) / 60))
