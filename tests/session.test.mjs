// 기획 v11 2단계: 오늘 몫 한 세션 — 카드 상태 → 연습(planStep) · 연습 결과 → FSRS 채점(autoGrade · X/O) · 짝 맞추기 묶음 채점
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHOICE_MS, FIRST_DAYS, LONG_DAYS, OX_RATING, WRITE_MS,
  autoGrade, limitFor, mergePool, orderToday, oxCount, planStep, practiceMode, sinceLabel, stageOf, todayCounts,
} from '../src/session.ts'
import { deckReducer, initDeck } from '../src/deck.ts'

const NOW = new Date('2026-11-02T03:00:00Z')
const DAY = 86_400_000
const DAY_END = '2026-11-02T19:00:00.000Z'
const ago = (d) => new Date(NOW.getTime() - d * DAY).toISOString()

const card = (id, state = 0, extra = {}) => ({
  word_id: id, state, due: ago(0.1), stability: state ? 5 : 0, difficulty: state ? 5 : 0, elapsed_days: 0,
  scheduled_days: state === 2 ? 6 : 0, learning_steps: 0, reps: state ? 3 : 0, lapses: 0,
  last_review: state ? ago(6) : null, introduced_at: state ? ago(40) : null, suspended: 0, ...extra,
})
const GLOSS = ['결정', '계약', '환경', '습관', '건물', '경험', '이사', '연착', '지원', '배려', '서류', '통지', '여건', '지장', '증명']
const word = (id, i, extra = {}) => ({
  id, lemma: `Wort${String.fromCharCode(65 + i)}${'x'.repeat(i)}`, pos: 'noun', gender: 'die', plural: null, ipa: null, level: 'B1',
  gloss_en: null, gloss_ko: GLOSS[i % GLOSS.length] + i, example_de: null, example_ko: null, example_hit: null, image: false, seq: i, ...extra,
})
let n = 0
const item = (state = 0, cardExtra = {}, wordExtra = {}) => {
  const i = n++
  const id = `w${i}`
  return { word: word(id, i, wordExtra), card: card(id, state, cardExtra) }
}
// 보기 재료: 같은 품사 명사 12개
const POOL = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, lemma: `Pool${i}word`, pos: 'noun', gender: 'der', gloss_ko: `보기${i}` }))
const FRUIT = ['Kirsche', 'Birne', 'Pflaume', 'Traube', 'Melone', 'Banane', 'Zitrone', 'Mango', 'Orange', 'Feige', 'Dattel', 'Ananas', 'Papaya', 'Quitte', 'Olive', 'Limette', 'Kokosnuss', 'Erdbeere', 'Himbeere', 'Brombeere', 'Aprikose', 'Mandarine', 'Nektarine', 'Pampelmuse']
const ctx = (extra = {}) => ({ pool: POOL, now: NOW, rand: () => 0.42, ...extra })

test('stageOf: 새 단어 · 배우는 중(state 1 · 처음 며칠) · 복습 짧음/김 · 잊은 단어', () => {
  assert.equal(stageOf(card('a', 0), NOW), 'new')
  assert.equal(stageOf(card('a', 1), NOW), 'learning')
  assert.equal(stageOf(card('a', 2, { introduced_at: ago(FIRST_DAYS - 1) }), NOW), 'learning', '배운 지 며칠 안 된 복습은 퀴즈로')
  assert.equal(stageOf(card('a', 2, { scheduled_days: LONG_DAYS - 1 }), NOW), 'short')
  assert.equal(stageOf(card('a', 2, { scheduled_days: LONG_DAYS }), NOW), 'long')
  assert.equal(stageOf(card('a', 3), NOW), 'lapsed')
})

test('autoGrade(R2): 틀림 = 다시 · 8초 안 힌트 없이 맞힘 = 좋음 · 늦거나 힌트 = 어려움 · 쓰기는 20초', () => {
  assert.equal(autoGrade({ correct: false, ms: 500 }), 1)
  assert.equal(autoGrade({ correct: false, ms: 500, hint: true }), 1)
  assert.equal(autoGrade({ correct: true, ms: CHOICE_MS - 1 }), 3)
  assert.equal(autoGrade({ correct: true, ms: CHOICE_MS }), 3, '경계 = 시간 안')
  assert.equal(autoGrade({ correct: true, ms: CHOICE_MS + 1 }), 2)
  assert.equal(autoGrade({ correct: true, ms: 1000, hint: true }), 2)
  assert.equal(limitFor('write'), WRITE_MS)
  assert.equal(limitFor('cloze'), CHOICE_MS)
  assert.equal(autoGrade({ correct: true, ms: 15_000 }, limitFor('write')), 3)
  assert.equal(autoGrade({ correct: true, ms: 15_000 }, limitFor('meaning')), 2)
})

test('카드 뒤집기 X · O → FSRS 다시(1) · 좋음(3) · O/X 셈은 어려움도 O', () => {
  assert.deepEqual(OX_RATING, { x: 1, o: 3 })
  assert.deepEqual(oxCount([{ rating: 1 }, { rating: 2 }, { rating: 3 }, { rating: 4 }, { rating: 1 }]), { o: 3, x: 2 })
})

test('orderToday: 복습 → 새 단어 → 퀴즈(같은 무리 안은 서버 차례) · 알림 정답 카드는 맨 앞', () => {
  const r1 = item(2), l1 = item(1), r2 = item(2, { scheduled_days: 30 }), z1 = item(3), f1 = item(0), f2 = item(0)
  const t = { due: [l1, r1, z1, r2], fresh: [f1, f2] }
  const ids = (q) => q.map((it) => it.word.id)
  assert.deepEqual(ids(orderToday(t, null, NOW)), ids([r1, r2, f1, f2, l1, z1]))
  assert.deepEqual(ids(orderToday(t, f2.word.id, NOW)), ids([f2, r1, r2, f1, l1, z1]))
  assert.deepEqual(todayCounts(t, NOW), { review: 2, fresh: 2, quiz: 2 })
})

test('planStep: 카드 상태 → 연습(기획 5절 표)', () => {
  const ex = { example_de: 'Das war keine leichte Wortsache heute.', example_ko: '예문' }
  // 새 단어 = 소개 → 뜻 고르기
  const fresh = item(0)
  let s = planStep([fresh], 0, ctx())
  assert.equal(s.kind, 'meaning')
  assert.equal(s.intro, true)
  assert.equal(s.q.choices.length, 4)
  // 잊은 단어 = 소개 다시 → 빈칸(예문에서 찾을 수 있을 때)
  const lapsed = item(3, {}, { lemma: 'Wortsache', ...ex })
  s = planStep([lapsed], 0, ctx())
  assert.equal(s.kind, 'cloze')
  assert.equal(s.intro, true)
  // 예문이 없으면 뜻 고르기로
  s = planStep([item(3)], 0, ctx())
  assert.equal(s.kind, 'meaning')
  // 복습(간격 짧음) = 뒤집기
  s = planStep([item(2)], 0, ctx())
  assert.equal(s.kind, 'flip')
  assert.equal(s.intro, false)
  // 복습(간격 김) = 명사는 관사 · 나머지는 쓰기 · 뜻 없으면 뒤집기
  assert.equal(planStep([item(2, { scheduled_days: 40 })], 0, ctx()).kind, 'artikel')
  assert.equal(planStep([item(2, { scheduled_days: 40 }, { pos: 'verb', gender: null })], 0, ctx()).kind, 'write')
  assert.equal(planStep([item(2, { scheduled_days: 40 }, { pos: 'verb', gender: null, gloss_ko: null })], 0, ctx()).kind, 'flip')
  assert.equal(planStep([item(2, { scheduled_days: 40 }, { gender: 'der/das' })], 0, ctx()).kind, 'write', '관사가 둘이면 관사 고르기 안 함')
  // 보기 재료가 모자라면 뒤집기
  assert.equal(planStep([item(0)], 0, ctx({ pool: [] })).kind, 'flip')
  assert.equal(planStep([], 0, ctx()), null)
})

test('planStep: 배우는 카드 5장이 모이면 짝 맞추기(연달아 두 번은 안 함), 모자라면 빈칸 · 이미 본 카드는 안 당겨 옴', () => {
  const ex = (k) => ({ lemma: FRUIT[k], example_de: `Ich esse heute eine ${FRUIT[k]} zum Essen.`, example_ko: '예문' })
  const learn = Array.from({ length: 6 }, (_, k) => item(1, {}, ex(k)))
  const review = item(2)
  // 복습 카드가 사이에 있어도 줄 앞쪽의 배우는 카드를 모은다
  const queue = [learn[0], review, ...learn.slice(1)]
  let s = planStep(queue, 0, ctx())
  assert.equal(s.kind, 'match')
  assert.equal(s.items.length, 5)
  assert.equal(s.items[0], learn[0], '지금 카드가 맨 앞')
  assert.ok(!s.items.includes(review))
  assert.deepEqual(new Set(s.q.left.map((c) => c.id)), new Set(s.items.map((it) => it.word.id)))
  // 바로 앞이 짝이면 이번엔 빈칸
  s = planStep(queue, 0, ctx({ lastKind: 'match' }))
  assert.equal(s.kind, 'cloze')
  // 이 세션에서 이미 본 카드(다시 보기 차례)는 묶음에 안 넣는다 → 4장뿐이면 빈칸
  s = planStep(learn.slice(0, 5), 0, ctx({ seen: { [learn[3].word.id]: 1 } }))
  assert.equal(s.kind, 'cloze')
})

test('planStep(+10개 연습): 뒤집기 · 관사 · 소개 없이 퀴즈만 · 기록 방식', () => {
  assert.equal(planStep([item(2)], 0, ctx({ practice: true })).kind, 'meaning')
  assert.equal(planStep([item(2, { scheduled_days: 40 })], 0, ctx({ practice: true })).kind, 'write')
  const s = planStep([item(3)], 0, ctx({ practice: true }))
  assert.equal(s.intro, false)
  assert.equal(planStep([item(2)], 0, ctx({ practice: true, pool: [] })).kind, 'write', '보기가 모자라면 쓰기')
  assert.equal(practiceMode('cloze'), 'cloze')
  assert.equal(practiceMode('match'), 'match')
  assert.equal(practiceMode('flip'), null)
  assert.equal(practiceMode('artikel'), null)
})

test('gradeMany: 짝 맞추기 5장 = 카드마다 채점 하나(줄 앞쪽 카드를 당겨 와서) · 되돌리기는 묶음째', () => {
  const learn = Array.from({ length: 5 }, () => item(1))
  const review = item(2)
  const queue = [learn[0], review, ...learn.slice(1)]
  let s = initDeck(queue, 1, DAY_END)
  const at = (k) => new Date(NOW.getTime() + k * 1000).toISOString()
  const grades = [learn[2], learn[0], learn[4], learn[1], learn[3]].map((it, k) => ({ word_id: it.word.id, rating: k === 2 ? 1 : 3, at: at(k) }))
  // 지금 카드가 빠졌거나 줄에 없는 카드가 섞이면 아무것도 안 한다
  assert.equal(deckReducer(s, { type: 'gradeMany', grades: grades.filter((g) => g.word_id !== learn[0].word.id) }), s)
  assert.equal(deckReducer(s, { type: 'gradeMany', grades: [...grades, { word_id: 'nope', rating: 3, at: at(9) }] }), s)
  const before = s
  // 맞춘 차례(learn 2 → 0 → 4 → 1 → 3)로 넘겨도 줄 차례로 채점한다
  s = deckReducer(s, { type: 'gradeMany', grades })
  assert.equal(s.pending.length, 5, '카드마다 하나')
  assert.deepEqual(s.pending.map((p) => p.word_id), learn.map((it) => it.word.id))
  assert.equal(s.pending.find((p) => p.word_id === learn[4].word.id).rating, 1, '카드마다 제 채점')
  assert.equal(new Set(s.pending.map((p) => p.word_id)).size, 5, '두 번 채점된 카드 없음')
  assert.equal(s.index, 5)
  assert.equal(s.queue[5].word.id, review.word.id, '당겨 오지 않은 카드가 그다음')
  // 틀린(다시) 카드는 오늘 안에 다시 → 같은 판 뒤로 한 번
  assert.equal(s.queue.filter((it) => it.word.id === learn[4].word.id).length, 2)
  s = deckReducer(s, { type: 'undo' })
  assert.deepEqual(s.queue, before.queue)
  assert.equal(s.pending.length, 0)
})

test('skip: 채점 없이 다음 카드(오늘 몫에 남음)', () => {
  const q = [item(2), item(2)]
  let s = initDeck(q, 1, DAY_END)
  s = deckReducer(s, { type: 'skip' })
  assert.equal(s.index, 1)
  assert.equal(s.pending.length, 0)
  s = deckReducer(s, { type: 'skip' })
  assert.equal(s.finished, true)
})

test('세션 끝까지: 단계마다 채점 수 = 그 단계 카드 수, 소개는 채점 안 함, 모든 카드가 채점됨', () => {
  const ex = (k) => ({ lemma: FRUIT[k], example_de: `Ich esse heute eine ${FRUIT[k]} zum Essen.`, example_ko: '예문' })
  const t = {
    due: [...Array.from({ length: 3 }, () => item(2)), ...Array.from({ length: 6 }, (_, k) => item(1, {}, ex(k))), item(3, {}, ex(9))],
    fresh: Array.from({ length: 4 }, (_, k) => item(0, {}, ex(20 + k))),
  }
  const queue = orderToday(t, null, NOW)
  const pool = mergePool(POOL, queue)
  let s = initDeck(queue, 1, DAY_END)
  let lastKind = null
  let clock = NOW.getTime()
  const kinds = []
  for (let guard = 0; !s.finished && guard < 200; guard++) {
    const step = planStep(s.queue, s.index, { pool, seen: s.reshows, lastKind, now: new Date(clock), rand: () => 0.3 })
    const before = s.pending.length
    if (step.items.length === 1) s = deckReducer(s, { type: 'grade', rating: 3, at: new Date((clock += 1000)).toISOString() })
    else s = deckReducer(s, { type: 'gradeMany', grades: step.items.map((it) => ({ word_id: it.word.id, rating: 3, at: new Date((clock += 1000)).toISOString() })) })
    assert.equal(s.pending.length - before, step.items.length, `${step.kind}: 카드마다 채점 하나`)
    kinds.push(step.kind)
    lastKind = step.kind
  }
  assert.equal(s.finished, true)
  const graded = new Set(s.pending.map((p) => p.word_id))
  for (const it of queue) assert.ok(graded.has(it.word.id), `${it.word.id} 채점됨`)
  assert.ok(kinds.includes('flip') && kinds.includes('meaning') && kinds.includes('match') && kinds.includes('cloze'), kinds.join(','))
})

test('sinceLabel(카드 표지): 새 단어 · 다시 · 오늘 또 · 6일 만 · 2개월 만', () => {
  assert.equal(sinceLabel(card('a', 0), NOW).text, '새 단어')
  assert.equal(sinceLabel(card('a', 3), NOW).text, '다시')
  assert.equal(sinceLabel(card('a', 2, { last_review: ago(0.01) }), NOW).text, '오늘 또')
  assert.equal(sinceLabel(card('a', 2, { last_review: ago(6) }), NOW).text, '6일 만')
  assert.equal(sinceLabel(card('a', 2, { last_review: ago(65) }), NOW).text, '2개월 만')
})
