// scripts/judge.mjs — 눈가림 3단계(묘사+객관식 → 몸·틀·글자·기호) · AI 차례(Groq → Gemini) · 빈 답 넘어가기 · 그림 줄이기 · 손 실행 예약. fetch 를 바꿔 끼워 네트워크 없이.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { answer, readBody } from './helpers/judge-mock.mjs'

process.env.AI_RETRY_MS = '0'
process.env.GEMINI_API_KEY = 'k-g'
process.env.GROQ_API_KEY = 'k-q'
const { judgeImages, setJudgeLedger, setDistractorPool, parseBlind, buildOptions, styleVerdict, pickDistractors } = await import('../scripts/judge.mjs')
const { emptyLedger, ledgerConfig, recordJudgeUsage } = await import('../scripts/ledger.mjs')

const png = await sharp({ create: { width: 1024, height: 768, channels: 3, background: '#fff' } }).png().toBuffer()
const items = [{ id: 'w1', word: 'Hund', meaning_ko: '개', png }]
const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
const gemini = (text) => json(200, { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } })
const groq = (text, total = 1234) => json(200, { choices: [{ message: { content: text } }], usage: { total_tokens: total } })

// groqFn · geminiFn: (prompt, nImages) => 답 글. 문자열이면 어느 단계든 그 글. 기본 = 모의 AI 가 단계에 맞게 정답으로 답함
async function run({ groqFn = (p) => answer(p), geminiFn = (p) => answer(p), list = items } = {}) {
  const orig = globalThis.fetch
  const hits = []
  const sent = []
  const prompts = []
  globalThis.fetch = async (url, init) => {
    const g = String(url).includes('groq')
    hits.push(g ? 'groq' : 'gemini')
    const { text, images } = readBody(JSON.parse(init.body))
    prompts.push(text)
    sent.push(images.map((c) => (g ? c.image_url.url : c.inline_data.data)))
    const f = g ? groqFn : geminiFn
    const out = typeof f === 'string' ? f : f(text, images.length)
    return g ? groq(out) : gemini(out)
  }
  const log = console.log, err = console.error
  console.log = console.error = () => {}
  try {
    return { res: await judgeImages(list), hits, sent, prompts }
  } finally {
    globalThis.fetch = orig
    console.log = log
    console.error = err
  }
}

test('기본 차례: Groq 가 두 단계 모두 답하면 Gemini 는 안 부른다 — 요청은 눈가림 + 칸 검사 둘', async () => {
  const { res, hits } = await run()
  assert.deepEqual(hits, ['groq', 'groq'])
  assert.equal(res.get('w1').ok, true)
  assert.equal(res.get('w1').stage, 'style')
})

test('③ 몸 검사: 다리 칸이 false 면 탈락 + 이유 + 고친 장면', async () => {
  const bad = (p) => answer(p, { style: { legs_ok: false, why: '다리가 5개', scene: 'Borti sits still, front view, all four paws visible' } })
  const { res } = await run({ groqFn: bad })
  const v = res.get('w1')
  assert.equal(v.ok, false)
  assert.match(v.why, /다리 수/)
  assert.match(v.scene, /^Borti sits/)
})

test('모델이 ok:true 를 적어도 칸이 false 면 탈락 · ok:false 를 적어도 칸이 모두 true 면 통과(모델 ok 무시)', async () => {
  const a = await run({ groqFn: (p) => answer(p, { style: { ok: true, frame_ok: false } }) })
  assert.equal(a.res.get('w1').ok, false)
  assert.match(a.res.get('w1').why, /틀/)
  const b = await run({ groqFn: (p) => answer(p, { style: { ok: false } }) })
  assert.equal(b.res.get('w1').ok, true)
})

test('① ② 눈가림: 정답을 못 맞히면 ③ 은 부르지 않고 탈락 · 글 AI 가 새 장면을 준다', async () => {
  const { res, hits, prompts } = await run({ groqFn: (p) => answer(p, { wrong: [1] }) })
  const v = res.get('w1')
  assert.equal(v.ok, false)
  assert.equal(v.stage, 'blind')
  assert.match(v.why, /눈가림/)
  assert.equal(hits.filter((h) => h === 'groq').length, 1) // 칸 검사 요청 없음
  assert.ok(prompts.some((p) => p.includes('You rewrite image scenes'))) // fixScenes — 글 요청 한 번
  assert.match(v.scene, /^Borti/)
})

test('눈가림 프롬프트에는 정답 낱말이 라벨 없이 보기 여섯 중 하나로만 들어간다(단어·뜻을 따로 알리지 않음)', async () => {
  const { prompts } = await run()
  const p = prompts[0]
  assert.match(p, /NOT told which word/)
  assert.match(p, /list A/)
  assert.equal((p.match(/Hund/g) ?? []).length, 2) // 목록 A · B 에 한 번씩
  assert.doesNotMatch(p, /meaning_ko|Cards:/)
})

test('두 칸 장면(twoPanel)은 ③ 에서 칸 수 2 를 요구한다', async () => {
  const one = (p) => answer(p, { style: { panels: 1 } })
  const a = await run({ groqFn: one, list: [{ ...items[0], scene: 'Two panels: left — Borti sits by a full bowl; right — same, the bowl is empty' }] })
  assert.equal(a.res.get('w1').ok, false)
  assert.match(a.res.get('w1').why, /두 칸 아님/)
  const two = (p) => answer(p, { style: { panels: 2 } })
  const b = await run({ groqFn: two, list: [{ ...items[0], scene: 'Two panels: left — Borti sits by a full bowl; right — same, the bowl is empty' }] })
  assert.equal(b.res.get('w1').ok, true)
  // 한 칸 장면에서 칸이 나뉘어 있으면 탈락
  const c = await run({ groqFn: two, list: [{ ...items[0], scene: 'Borti jumps over a puddle' }] })
  assert.equal(c.res.get('w1').ok, false)
})

test('parseBlind: 번호·pick 이 빠진 항목은 판정 못 받음 · 두 목록 모두 맞아야 pass', () => {
  const it = { id: 'w1', word: 'Hund', meaning_ko: '개' }
  it._opts = buildOptions(it)
  const { correctA, correctB } = it._opts
  const m = parseBlind([{ n: 1, desc: 'd', pick_a: correctA, pick_b: correctB }, { n: 2, pick_a: 'A', pick_b: 'A' }, { n: 1 }], [it])
  assert.equal(m.get(1).pass, true)
  const half = parseBlind([{ n: 1, pick_a: correctA, pick_b: correctB === 'A' ? 'B' : 'A' }], [it])
  assert.equal(half.get(1).pass, false)
  assert.equal(parseBlind([{ n: 1, pick_a: 'X', pick_b: 'X' }], [it]).get(1).pass, false)
  assert.equal(parseBlind('쓰레기', [it]).size, 0)
})

test('styleVerdict: 칸이 모두 true 면 통과, 기호만으로 표현은 탈락', () => {
  assert.equal(styleVerdict({ legs_ok: true, body_ok: true, frame_ok: true, text_ok: true, symbol_ok: true, panels: 1 }, {}).ok, true)
  const v = styleVerdict({ symbol_ok: false, legs_ok: true }, {})
  assert.equal(v.ok, false)
  assert.match(v.why, /기호/)
})

test('보기: 같은 품사·등급을 앞세우고 정답과 같은 낱말은 뺀다', () => {
  const pool = [
    { id: 'a', word: 'der Baum', meaning_ko: '나무', pos: 'noun', level: 'B1' },
    { id: 'b', word: 'laufen', meaning_ko: '달리다', pos: 'verb', level: 'B1' },
    { id: 'c', word: 'die Katze', meaning_ko: '고양이', pos: 'noun', level: 'B1' },
    { id: 'd', word: 'das Haus', meaning_ko: '집', pos: 'noun', level: 'C1' },
    { id: 'e', word: 'der Hund', meaning_ko: '개', pos: 'noun', level: 'B1' },
    { id: 'f', word: 'der Tisch', meaning_ko: '탁자', pos: 'noun', level: 'B1' },
    { id: 'g', word: 'die Lampe', meaning_ko: '등', pos: 'noun', level: 'B1' },
  ]
  const d = pickDistractors({ id: 'x', word: 'der Hund', meaning_ko: '개', pos: 'noun', level: 'B1' }, pool, 5)
  assert.equal(d.length, 5)
  assert.ok(!d.some((o) => o.word === 'der Hund'))
  assert.ok(!d.some((o) => o.word === 'laufen')) // 다른 품사는 맨 뒤
  // 같은 입력이면 늘 같은 보기(결정적)
  assert.deepEqual(d, pickDistractors({ id: 'x', word: 'der Hund', meaning_ko: '개', pos: 'noun', level: 'B1' }, pool, 5))
})

test('setDistractorPool 로 채운 후보가 눈가림 프롬프트에 들어간다', async () => {
  setDistractorPool([{ id: 'p1', word: 'die Katze', meaning_ko: '고양이', pos: 'noun' }])
  try {
    const { prompts } = await run({ list: [{ ...items[0], pos: 'noun' }] })
    assert.match(prompts[0], /die Katze — 고양이/)
  } finally {
    setDistractorPool([])
  }
})

test('Groq 가 빈 배열을 주면 Gemini 로 넘어간다', async () => {
  const { res, hits } = await run({ groqFn: '[]' })
  assert.deepEqual(hits, ['groq', 'gemini', 'gemini'])
  assert.equal(res?.get('w1')?.ok, true)
})

test('Groq 가 번호 없는 판정만 주어도 Gemini 로 넘어간다', async () => {
  const { res, hits } = await run({ groqFn: '[{"n":9,"desc":"x","pick_a":"A","pick_b":"A"}]' })
  assert.ok(hits.includes('gemini'))
  assert.equal(res?.get('w1')?.ok, true)
})

test('둘 다 못 주면 null(판정 못 함)', async () => {
  const { res } = await run({ groqFn: '[]', geminiFn: '[]' })
  assert.equal(res, null)
})

test('Groq 가 일부만 주면 못 받은 그림만 Gemini 로', async () => {
  const two = [...items, { id: 'w2', word: 'Katze', meaning_ko: '고양이', png }]
  const { res, hits, sent } = await run({ groqFn: (p) => answer(p, { only: 1 }), list: two })
  assert.deepEqual(hits, ['groq', 'groq', 'gemini', 'gemini']) // Groq: 눈가림(1장만 답) + 칸 검사 · Gemini: w2 의 두 요청
  assert.equal(sent[2].length, 1) // Gemini 눈가림에는 w2 한 장
  assert.equal(res.size, 2)
})

test('JUDGE_ORDER 로 차례를 바꾼다', async () => {
  process.env.JUDGE_ORDER = 'gemini,groq'
  try {
    const { hits } = await run()
    assert.deepEqual([...new Set(hits)], ['gemini'])
  } finally {
    delete process.env.JUDGE_ORDER
  }
})

test('검사 AI 에는 긴 변 512 로 줄인 그림을 보낸다', async () => {
  const { sent } = await run()
  const b64 = sent[0][0].replace('data:image/png;base64,', '')
  const m = await sharp(Buffer.from(b64, 'base64')).metadata()
  assert.equal(Math.max(m.width, m.height), 512)
})

test('사용량 장부: Groq 토큰 · Gemini 요청을 적는다(그림당 요청 약 2배)', async () => {
  const ledger = emptyLedger()
  setJudgeLedger({ ledger, cfg: ledgerConfig({}), day: () => '2026-10-30' })
  try {
    await run({ groqFn: '[]' })
    const j = ledger.days['2026-10-30'].judge
    assert.deepEqual(j.groq, { requests: 1, tokens: 1234 }) // 빈 답도 성공한 호출 — 다시 묻지 않고 Gemini 로
    assert.deepEqual(j.gemini, { requests: 2, tokens: 30 }) // 눈가림 + 칸 검사
  } finally {
    setJudgeLedger(null)
  }
})

test('손 실행은 Groq 하루 토큰의 60% 까지만 — 넘으면 Gemini 만, 둘 다 막히면 null', async () => {
  const ledger = emptyLedger()
  const cfg = ledgerConfig({ DAILY_RUN_KIND: 'manual', GROQ_TPD: '200000', JUDGE_RESERVE: '0.4', GEMINI_RPD: '20' })
  recordJudgeUsage(ledger, '2026-10-30', 'groq', 119_000) // 60% = 120,000, 한 번 평균 119,000 → 넘는다
  setJudgeLedger({ ledger, cfg, day: () => '2026-10-30' })
  try {
    const a = await run()
    assert.deepEqual([...new Set(a.hits)], ['gemini'])
    for (let i = 0; i < 12; i++) recordJudgeUsage(ledger, '2026-10-30', 'gemini', 0) // 20 × 0.6 = 12
    const b = await run()
    assert.equal(b.res, null)
    assert.deepEqual(b.hits, [])
  } finally {
    setJudgeLedger(null)
  }
})

test('예약 실행은 같은 사용량에서도 Groq 를 부른다', async () => {
  const ledger = emptyLedger()
  const cfg = ledgerConfig({ DAILY_RUN_KIND: 'scheduled', GROQ_TPD: '200000' })
  recordJudgeUsage(ledger, '2026-10-30', 'groq', 20_000)
  setJudgeLedger({ ledger, cfg, day: () => '2026-10-30' })
  try {
    const { hits } = await run()
    assert.deepEqual([...new Set(hits)], ['groq'])
  } finally {
    setJudgeLedger(null)
  }
})
