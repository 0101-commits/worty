// 2026-11-02 v11 그림 품질(G1~G7): 낱말 종류 · 두 칸 프롬프트 · 금지 소품 · 겹치는 장면 · dHash · 틀 검사 · few-shot · 상태 합치기 · 다시 그리기 SQL.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { BANNED_PROPS, ROLE_HINTS, SCENE_MAX, addFeedback, bannedIn, classifyWord, contentWords, fewShotBlock, findDuplicateScene, isPinned, isTwoPanel, parseTwoPanel, sceneOverlap, sceneRulesBlock, stripPin, SCENE_RULE_SHORT } from '../scripts/scene.mjs'
import { STYLE, imagePrompt } from '../scripts/style.mjs'
import { dhash, hamming, nearDuplicate } from '../scripts/imghash.mjs'
import { frameStats, verdict } from '../scripts/imgcheck.mjs'
import { merge } from '../scripts/merge-state.mjs'
import { SCENES, buildSql } from '../scripts/redraw-v11.mjs'
import { parseIds, queueExisting } from '../scripts/review-queue.mjs'
import { acceptContent, contentPrompt } from '../scripts/words/lib.mjs'

// ---------- G1 낱말 종류 ----------
test('classifyWord: 직업 · 동사 · 형용사 · 구체 명사 · 추상 낱말', () => {
  assert.equal(classifyWord({ lemma: 'Richter', pos: 'noun' }), 'person')
  assert.equal(classifyWord({ lemma: 'Journalist', pos: 'noun' }), 'person')
  assert.equal(classifyWord({ lemma: 'Kanzlerin', pos: 'noun', gender: 'die' }), 'person')
  assert.equal(classifyWord({ lemma: 'Kühlschrank', pos: 'noun' }), 'concrete')
  assert.equal(classifyWord({ lemma: 'Gerechtigkeit', pos: 'noun' }), 'abstract')
  assert.equal(classifyWord({ lemma: 'springen', pos: 'verb' }), 'action')
  assert.equal(classifyWord({ lemma: 'eng', pos: 'adj' }), 'state')
  for (const pos of ['adv', 'conj', 'prep', 'pron', 'phrase', 'other']) assert.equal(classifyWord({ lemma: 'bereits', pos }), 'abstract')
})

test('직업 사전: 30개 넘고 각 항목이 물건+장소 힌트를 가진다 · 금지 소품이 없다', () => {
  assert.ok(Object.keys(ROLE_HINTS).length >= 30)
  for (const k of ['Richter', 'Bürgermeister', 'Minister', 'Zeuge', 'Angeklagter', 'Polizist', 'Arzt', 'Lehrer', 'Anwalt', 'Journalist', 'Soldat', 'Bauer', 'Koch', 'Pilot', 'Feuerwehrmann', 'Abgeordneter', 'Präsident', 'Kanzler', 'Botschafter', 'Bischof', 'Gärtner', 'Verkäufer', 'Kellner', 'Richterin']) assert.ok(ROLE_HINTS[k], k)
  assert.match(ROLE_HINTS.Richter, /gavel/)
  for (const [k, v] of Object.entries(ROLE_HINTS)) assert.deepEqual(bannedIn(v.replace(/ \(no letters\)/, '').replace(/ \(a small raised box with a rail\)/, '')), [], `${k}: ${v}`)
})

test('규칙 글: 낱말 종류 다섯 · 두 칸 형식 · 금지 목록이 프롬프트에 들어간다', () => {
  const r = sceneRulesBlock()
  for (const w of ['concrete noun', 'person/role noun', 'action verb', 'state adjective', 'abstract', 'Two panels: left', 'podium', 'clipboard', 'magnifying glass', 'empty box']) assert.ok(r.includes(w), w)
  assert.ok(SCENE_RULE_SHORT.includes('Two panels'))
  const lib = contentPrompt([{ key: 'Richter|noun', lemma: 'Richter', pos: 'noun', level: 'B2' }])
  assert.match(lib, /person\/role = the two objects only that role has/)
  assert.match(lib, /"role_hint":"judge's black robe and a gavel/)
  assert.match(lib, /"class_hint":"person"/)
})

test('acceptContent: 금지 소품이 든 장면은 글만 받고 장면은 비운다 · 두 칸 장면은 받는다', () => {
  const base = { key: 'a|adv', keep: true, cefr: 'B2', gloss_ko: '이미', example_de: 'Er ist schon da.', example_ko: '그는 이미 와 있어요.' }
  const list = [{ key: 'a|adv' }]
  const bad = acceptContent([{ ...base, scene_en: 'Borti holds a clipboard with a check mark' }], list)
  assert.equal(bad.length, 1)
  assert.equal(bad[0].scene_en, null)
  const ok = acceptContent([{ ...base, scene_en: 'Two panels: left — Borti waits by a full bowl; right — same room, the bowl is already empty' }], list)
  assert.match(ok[0].scene_en, /^Two panels/)
})

// ---------- G3 금지 소품 ----------
test('bannedIn: 연단 · 클립보드 · 돋보기 · 기호 · 틀 · 글자를 잡고, 사랑 낱말이면 하트는 허용', () => {
  assert.deepEqual(bannedIn('Borti behind a podium'), ['podium'])
  assert.ok(bannedIn('Borti holds a clipboard and a magnifying glass').length === 2)
  assert.ok(bannedIn('Borti with a question mark above his head').includes('question mark'))
  assert.ok(bannedIn('Borti looks puzzled ?').includes('?'))
  assert.ok(bannedIn('Borti inside a frame').includes('frame'))
  assert.ok(bannedIn('Borti holds a big red X').length > 0)
  assert.ok(bannedIn('Borti hugs a heart').length > 0)
  assert.deepEqual(bannedIn('Borti hugs a heart', { allowHeart: true }), [])
  assert.deepEqual(bannedIn('Borti jumps over a puddle'), [])
  assert.ok(bannedIn('Borti in a panel').includes('panels'))
  assert.ok(BANNED_PROPS.includes('map'))
})

test('STYLE: 「기호는 괜찮다」가 빠졌고 틀 · 기호 금지가 들어갔다', () => {
  assert.doesNotMatch(STYLE, /are fine/)
  assert.match(STYLE, /No frame, border or panels/)
  assert.match(STYLE, /never by symbols/)
})

// ---------- G2 두 칸 ----------
const TWO = 'Two panels: left — a friend just arrives, Borti\'s bowl is full, a wall clock shows seven; right — same clock, Borti\'s bowl is already empty'

test('parseTwoPanel / isTwoPanel: 형식 인식 · [pin] 접두어 · 모자란 형식은 아님', () => {
  const p = parseTwoPanel(TWO)
  assert.match(p.left, /bowl is full/)
  assert.match(p.right, /already empty/)
  assert.equal(isTwoPanel(`[pin] ${TWO}`), true)
  assert.equal(isTwoPanel('Borti jumps'), false)
  assert.equal(isTwoPanel('Two panels: left — only a left side'), false)
})

test('imagePrompt: 두 칸 장면이면 칸막이 한 줄 · 바깥 틀 금지 지시, 한 칸 장면에는 없다', () => {
  const two = imagePrompt(TWO, true)
  assert.match(two, /exactly TWO equal panels/)
  assert.match(two, /ONE thin vertical black divider/)
  assert.match(two, /Left panel: a friend just arrives/)
  assert.match(two, /Right panel: same clock/)
  assert.match(two, /no outer frame or border/)
  assert.doesNotMatch(two, /No frame, border or panels/)
  assert.ok(two.length <= 2000)
  const one = imagePrompt('Borti jumps over a puddle', true)
  assert.doesNotMatch(one, /TWO equal panels/)
  assert.match(one, /No frame, border or panels/)
  assert.match(one, /Scene: Borti jumps/)
})

test('imagePrompt: 가장 긴 두 칸 장면도 잘리지 않고 2,000자 안', () => {
  const long = `Two panels: left — ${'Borti sits beside a food bowl with a round clock and a window above, '.repeat(2)}; right — ${'same room same clock Borti beside a bare bowl shining clean, '.repeat(2)}the end`
  const p = imagePrompt(long.slice(0, SCENE_MAX), true)
  assert.ok(p.length <= 2000, String(p.length))
  assert.match(p, /Right panel:/)
})

test('[pin]: 고정 장면 표시를 알아보고 그림 프롬프트에는 떼고 보낸다', () => {
  assert.equal(isPinned('[pin] Borti jumps'), true)
  assert.equal(isPinned('Borti jumps'), false)
  assert.equal(stripPin('[pin] Borti jumps'), 'Borti jumps')
  assert.doesNotMatch(imagePrompt('[pin] Borti jumps', true), /\[pin\]/)
})

// ---------- G5(a) 겹치는 장면 ----------
test('장면 겹침: 내용어 60% 이상 같으면 다른 단어의 장면으로 걸린다', () => {
  const a = 'Borti behind a wooden desk signing a long official paper with a golden pen'
  const b = 'Borti signing an official paper with a golden pen behind a wooden desk'
  assert.ok(sceneOverlap(a, b) >= 0.6)
  assert.equal(findDuplicateScene('w2', a, { w1: b }).id, 'w1')
  assert.equal(findDuplicateScene('w1', a, { w1: b }), null) // 자기 자신은 제외
  assert.equal(findDuplicateScene('w2', 'Borti mid-air jumping over a puddle in the rain', { w1: b }), null)
  assert.ok(contentWords('Borti the white puppy holding a big red ball').has('red'))
  assert.ok(!contentWords('Borti the white puppy holding a big red ball').has('borti'))
})

// ---------- G5(b) dHash ----------
async function pic(draw) {
  const w = 160, h = 120
  const buf = Buffer.alloc(w * h * 3, 255)
  draw((x, y, v = 0) => { if (x >= 0 && y >= 0 && x < w && y < h) { const i = (y * w + x) * 3; buf[i] = buf[i + 1] = buf[i + 2] = v } }, w, h)
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
}
const disc = (cx, cy, r) => (set) => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, 40) }
const bar = (x0, y0, x1, y1) => (set) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, 40) }

test('dHash: 같은 그림은 거리 0, 크기를 줄여도 거의 같고, 다른 그림은 멀다', async () => {
  const a = await pic(disc(60, 60, 30))
  const b = await pic(bar(20, 20, 140, 50))
  const ha = await dhash(a)
  assert.equal(ha.length, 64)
  assert.equal(hamming(ha, await dhash(a)), 0)
  const small = await sharp(a).resize(80, 60).jpeg().toBuffer()
  assert.ok(hamming(ha, await dhash(small)) <= 10)
  assert.ok(hamming(ha, await dhash(b)) > 30)
  assert.equal(hamming('00', '0'), Infinity)
})

test('nearDuplicate: 다른 단어의 거의 같은 그림만 걸리고 자기 id 는 건너뛴다', async () => {
  const ha = await dhash(await pic(disc(60, 60, 30)))
  const hb = await dhash(await pic(bar(20, 20, 140, 50)))
  const store = { w1: ha, w2: hb }
  assert.equal(nearDuplicate('w3', ha, store).id, 'w1')
  assert.equal(nearDuplicate('w1', ha, store), null)
  assert.equal(nearDuplicate('w3', await dhash(await pic(disc(100, 30, 12))), store), null)
})

// ---------- G6 틀 검사 ----------
const frameOf = (sides, { divider = false, ground = false } = {}) =>
  pic((set, w, h) => {
    const t = 3, m = 8
    if (sides.includes('t')) bar(m, m, w - m, m + t)(set)
    if (sides.includes('b')) bar(m, h - m - t, w - m, h - m)(set)
    if (sides.includes('l')) bar(m, m, m + t, h - m)(set)
    if (sides.includes('r')) bar(w - m - t, m, w - m, h - m)(set)
    if (divider) bar(w / 2 - 1, 10, w / 2 + 1, h - 10)(set)
    if (ground) bar(40, h - 20, 110, h - 18)(set)
    disc(w / 2, h / 2, 12)(set) // 가운데 그림 덩어리
  })

test('frameStats: 네 변 틀 · 세 변 틀은 틀, 한 변(바닥 선)이나 가운데 칸막이만은 틀이 아니다', async () => {
  assert.equal((await frameStats(await frameOf('tblr'))).edges, 4)
  assert.equal((await frameStats(await frameOf('tbl'))).edges, 3)
  const two = await frameStats(await frameOf('', { divider: true }))
  assert.equal(two.edges, 0)
  assert.equal(two.divider, true)
  const ground = await frameStats(await frameOf('', { ground: true }))
  assert.equal(ground.edges, 0)
  assert.equal(ground.divider, false)
  assert.equal((await frameStats(await frameOf('b'))).edges, 1)
  assert.equal((await frameStats(await frameOf('tb'))).edges, 2)
})

test('verdict: 틀 3변 이상이면 frame 이유가 붙는다', async () => {
  const clean = { edgeWhite: 0.95, top4: 0.95, black: 0.05 }
  assert.deepEqual(verdict(clean, 0, { edges: 2, divider: false }), [])
  assert.deepEqual(verdict(clean, 0, { edges: 3, divider: false }), ['frame 3'])
  assert.deepEqual(verdict(clean, 0, { edges: 0, divider: true }), []) // 두 칸 칸막이는 통과
  assert.deepEqual(verdict(clean, 0), [])
})

// ---------- G7 few-shot · 결정 기록 ----------
test('addFeedback · fewShotBlock: 좋은·나쁜 예를 각 2개까지, 같은 종류를 앞세우고, 같은 단어는 최신 하나만', () => {
  let fb = []
  fb = addFeedback(fb, { id: 'w1', lemma: 'Richter', pos: 'noun', scene: 'Borti in a robe with a gavel at a bench', ok: true, at: '2026-11-01T00:00:00Z' })
  fb = addFeedback(fb, { id: 'w2', lemma: 'springen', pos: 'verb', scene: 'Borti mid-air over a puddle', ok: true, at: '2026-11-01T00:01:00Z' })
  fb = addFeedback(fb, { id: 'w3', lemma: 'Zeuge', pos: 'noun', scene: 'Borti behind a podium', ok: false, at: '2026-11-01T00:02:00Z' })
  fb = addFeedback(fb, { id: 'w4', lemma: 'bereits', pos: 'adv', scene: 'Borti with a clipboard', ok: false })
  fb = addFeedback(fb, { id: 'w5', lemma: 'kämpfen', pos: 'verb', scene: 'Borti with a pillow', ok: false })
  fb = addFeedback(fb, { id: 'w3', lemma: 'Zeuge', pos: 'noun', scene: '[pin] Borti behind a podium (again)', ok: false })
  assert.equal(fb.filter((x) => x.id === 'w3').length, 1)
  assert.equal(fb.find((x) => x.id === 'w3').scene, 'Borti behind a podium (again)') // [pin] 은 뗀다
  const block = fewShotBlock(fb, ['person'], 2)
  assert.match(block, /KEPT/)
  assert.match(block, /REJECTED/)
  assert.match(block, /Richter: Borti in a robe/)
  assert.equal((block.match(/ {2}· /g) ?? []).length, 4) // 좋은 2 + 나쁜 2 (좋은 쪽은 2개뿐이라 모두)
  assert.ok(block.includes('Zeuge') && block.includes('kämpfen') && !block.includes('bereits')) // 사람 종류 먼저, 나머지는 최신순으로 2개까지
  assert.equal(fewShotBlock([], ['person']), '')
})

test('few-shot: 장면 쓰기 프롬프트에 들어갈 수 있게 한 덩어리 글이다', () => {
  const b = fewShotBlock([{ id: 'w1', lemma: 'x', pos: 'noun', scene: 'Borti does y', ok: true }], ['concrete'])
  assert.match(b, /imitate/)
  assert.match(b, /\(none yet\)/) // 나쁜 예가 아직 없을 때
})

test('merge-state: 지도는 main 위에 실행 것을 얹고, 목록은 id 마다 최신 하나', () => {
  assert.deepEqual(merge({ w1: 'a', w2: 'b' }, { w2: 'B', w3: 'c' }), { w1: 'a', w2: 'B', w3: 'c' })
  assert.deepEqual(merge(null, { w1: 'a' }), { w1: 'a' })
  const l = merge([{ id: 'w1', at: '1' }, { id: 'w2', at: '2' }], [{ id: 'w1', at: '3' }])
  assert.deepEqual(l.map((x) => `${x.id}@${x.at}`), ['w2@2', 'w1@3'])
})

test('review-queue: id 목록 읽기(문자열 · 객체 · 잘못된 것 거르기) 와 대기에 맡기기', async () => {
  assert.deepEqual(parseIds([{ id: 'w0012' }, 'w0017', { id: 'bad' }, 'w0012', null]), ['w0012', 'w0017'])
  const calls = []
  const fetchFn = async (url, init = {}) => {
    calls.push(`${init.method ?? 'GET'} ${url}`)
    if (String(url).includes('w0099')) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
  }
  const r = await queueExisting(['w0012', 'w0099'], { base: 'https://x', token: 't', fetchFn, say: () => {} })
  assert.deepEqual(r.queued, ['w0012'])
  assert.equal(r.failed[0].id, 'w0099')
  assert.ok(calls.includes('PUT https://x/api/admin/pending/w0012'))
  const dry = await queueExisting(['w0012'], { base: 'https://x', token: 't', fetchFn, dry: true, say: () => {} })
  assert.deepEqual(dry.queued, ['w0012'])
  assert.equal(calls.filter((c) => c.startsWith('PUT')).length, 1) // dry 는 맡기지 않는다
})

// ---------- 다시 그리기 목록 ----------
test('redraw_v11: 36단어 · 새 장면은 규칙 통과(금지 소품 없음 · 길이 · 서로 겹치지 않음) · 추상어는 두 칸', () => {
  const ids = Object.keys(SCENES)
  assert.equal(ids.length, 36)
  const idx = Object.fromEntries(ids.map((i) => [i, SCENES[i][1]]))
  for (const id of ids) {
    const sc = idx[id]
    assert.deepEqual(bannedIn(sc), [], `${id} ${SCENES[id][0]}: ${sc}`)
    assert.ok(sc.length <= SCENE_MAX, id)
    assert.ok(/^Borti\b/.test(sc) || isTwoPanel(sc) || /\bBorti\b/.test(sc), id)
    assert.equal(findDuplicateScene(id, sc, idx, 0.6), null, id)
  }
  assert.ok(ids.filter((i) => isTwoPanel(idx[i])).length >= 15)
  for (const id of ['w0007', 'w0384', 'w0548', 'w0674', 'w1024', 'w8397']) assert.ok(isTwoPanel(idx[id]), id) // 부사 · 추상 명사
})

test('redraw_v11 SQL: 단어마다 UPDATE 한 줄 — [pin] 장면 + image_status none + image_id NULL, 작은따옴표 이스케이프', () => {
  const sql = buildSql({ w0001: ['x', "Borti's ball"] })
  assert.match(sql, /UPDATE words SET scene_en = '\[pin\] Borti''s ball', image_status = 'none', image_id = NULL WHERE id = 'w0001';/)
  const all = buildSql().split('\n').filter((l) => l.startsWith('UPDATE'))
  assert.equal(all.length, 36)
  assert.ok(all.every((l) => l.includes("image_status = 'none'") && l.includes("'[pin] ")))
})
