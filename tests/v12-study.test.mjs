// 2026-11-03 개편: 소개 카드 뒤 퀴즈는 몇 장 뒤로 · 오늘 공부에 넣기 · 기사 낱말 바로 넣기 · 활용형으로 찾기 · 연습 결과 다시 받기
// D1(node:sqlite 흉내)와 Postgres(PGlite) 두 DB 에서 같은 결과
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { fakeD1 } from './d1.mjs';
import { createPgDb } from '../worker/db.ts';
import { deckReducer, initDeck } from '../src/deck.ts';
import { planStep } from '../src/session.ts';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject { constructor(s, e) { this.ctx = s; this.env = e; } }', shortCircuit: true };
  return next(spec, ctx);
}`));
crypto.subtle.timingSafeEqual ??= (a, b) => Buffer.from(a).equals(Buffer.from(b));
const { default: worker } = await import('../worker/index.ts');
const { kstDay } = await import('../worker/time.ts');
const { lemmaCandidates } = await import('../worker/study.ts');

const SCHEMA = readFileSync(new URL('../scripts/db/schema.pg.sql', import.meta.url), 'utf8');
async function pgDb() {
  const pg = new PGlite();
  await pg.exec(SCHEMA);
  const wrap = (q) => async (text, params) => {
    const r = await q.query(text, params, { parsers: { 20: Number, 1700: Number } });
    return Object.assign(r.rows, { count: r.affectedRows ?? 0 });
  };
  return createPgDb({ exec: wrap(pg), begin: (fn) => pg.transaction((tx) => fn(wrap(tx))) }, {});
}
const env = (db) => ({ DB: db, IMG: { get: async () => null, put: async () => undefined }, API_TOKEN: 't', APP_URL: 'https://x.test', SCHED: { idFromName: () => 'x', get: () => ({ ensure: async () => ({}) }) } });
async function call(db, method, path, body) {
  const init = { method, headers: { authorization: 'Bearer t', 'content-type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await worker.fetch(new Request('https://x.test' + path, init), env(db), { waitUntil() {} });
  return { status: res.status, body: await res.json() };
}

const LESSON = {
  summary_ko: ['가', '나', '다'],
  sentences: [{ de: 'Die Behörden haben eine Prüfung eingeleitet.', ko: '당국이 점검을 시작했다.' }],
  glossary: [
    { form: 'eingeleitet', lemma: 'einleiten', pos: 'verb', gender: null, gloss_ko: '시작하다', level: 'B2' },
    { form: 'Behörden', lemma: 'Behörde', pos: 'noun', gender: 'die', gloss_ko: '당국', level: 'B1' },
  ],
  expressions: [{ base: 'eine Prüfung einleiten', meaning_ko: '점검을 시작하다', s: 0 }],
  quiz: [],
};

async function run(db) {
  const day = kstDay();
  await db.prepare(`INSERT INTO words(id, lemma, pos, level, level_src, gloss_ko, gloss_status, seq, created_at) VALUES ('w0001', 'Behörde', 'noun', 'B1', 'goethe', '관청', 'checked', 1, '2026-11-01 00:00:00')`).run();
  await db.prepare(`INSERT INTO cards(word_id, state, due, reps) VALUES ('w0001', 2, '2099-01-01T00:00:00.000Z', 3)`).run();
  await db.prepare(`INSERT INTO words(id, lemma, pos, level, level_src, gloss_ko, gloss_status, seq, created_at) VALUES ('w0002', 'Prüfung', 'noun', 'B1', 'goethe', '시험', 'checked', 2, '2026-11-01 00:00:00')`).run();
  await db.prepare(`INSERT INTO cards(word_id, state, due) VALUES ('w0002', 0, '2026-11-01T00:00:00.000Z')`).run();
  await call(db, 'POST', '/api/admin/articles', { items: [{ source: 'kbs', ext_id: '1', url: 'https://k/1', title: 'Haupt', published_at: day + 'T01:00:00Z', day, role: 'main', body: 'x', words: 130, score: 1, lesson: LESSON }] });
  const art = (await call(db, 'GET', '/api/articles/today')).body.article;
  const out = {};
  out.lookupBehoerden = (await call(db, 'GET', '/api/lookup?form=Behörden')).body.items.map((x) => x.lemma);
  out.lookupNone = (await call(db, 'GET', '/api/lookup?form=Zxqv')).body.items.length;
  // 배운 단어 → 오늘 복습으로(마감을 지금으로), 두 번째는 이미 있음
  out.reviewFirst = (await call(db, 'POST', '/api/word/w0001/today')).body.mode;
  out.reviewAgain = (await call(db, 'POST', '/api/word/w0001/today')).body.mode;
  const t1 = (await call(db, 'GET', '/api/today')).body;
  out.dueHasW1 = t1.due.some((x) => x.word.id === 'w0001');
  // 안 배운 단어: 오늘 목록에 이미 있으면 그대로, 오늘 목록을 정한 뒤 들어온 단어는 맨 앞에
  out.freshMode = (await call(db, 'POST', '/api/word/w0002/today')).body.mode;
  await db.prepare(`INSERT INTO words(id, lemma, pos, level, level_src, gloss_ko, gloss_status, seq, created_at) VALUES ('w0003', 'Zulassung', 'noun', 'C1', 'goethe', '허가', 'checked', 3, '2026-11-01 00:00:00')`).run();
  await db.prepare(`INSERT INTO cards(word_id, state, due) VALUES ('w0003', 0, '2026-11-01T00:00:00.000Z')`).run();
  out.freshLate = (await call(db, 'POST', '/api/word/w0003/today')).body.mode;
  // 쉬게 한 카드도 깨워서 넣는다
  await call(db, 'POST', '/api/word/w0001/suspend', { suspended: true });
  out.woke = (await call(db, 'POST', '/api/word/w0001/today')).body.mode;
  out.unknown = (await call(db, 'POST', '/api/word/w9999/today')).status;
  // 기사 낱말 바로 넣기: 새 단어 + 문장이 예문 + 내가 넣은 단어 기록 + 오늘 새 단어 맨 앞
  const add = (await call(db, 'POST', `/api/articles/${art.id}/add-word`, { lemma: 'einleiten' })).body;
  out.add = { created: add.created, mode: add.mode };
  const w = await db.prepare('SELECT lemma, pos, level, level_src, gloss_ko, example_de, example_ko, example_src, pinned FROM words WHERE id = ?').bind(add.id).first();
  out.added = { ...w, pinned: Number(w.pinned) };
  out.req = { ...(await db.prepare("SELECT text, status, note FROM word_requests WHERE word_id = ?").bind(add.id).first()) };
  const t2 = (await call(db, 'GET', '/api/today')).body;
  out.freshFirst = t2.fresh[0]?.word.id === add.id;
  out.freshIds = t2.fresh.map((x) => x.word.lemma);
  const again = (await call(db, 'POST', `/api/articles/${art.id}/add-word`, { lemma: 'einleiten' })).body;
  out.addAgain = { created: again.created, mode: again.mode, same: again.id === add.id };
  out.notInLesson = (await call(db, 'POST', `/api/articles/${art.id}/add-word`, { lemma: 'Haus' })).status;
  // 연습 결과를 두 번 받아도 한 번만 적힌다
  const pr = { mode: 'cloze', results: [{ word_id: 'w0001', correct: false, at: '2026-11-03T01:00:00.000Z' }] };
  out.practice1 = (await call(db, 'POST', '/api/practice', pr)).body.count;
  out.practice2 = (await call(db, 'POST', '/api/practice', pr)).body.count;
  out.practiceRows = Number((await db.prepare('SELECT count(*) AS n FROM practice').first()).n);
  // 없는 단어의 채점은 건너뛰고 나머지는 적는다(묶음 전체 404 금지)
  const rv = await call(db, 'POST', '/api/reviews', { session_id: 's1', reviews: [{ word_id: 'w9999', rating: 3, reviewed_at: '2026-11-03T02:00:00.000Z' }, { word_id: 'w0002', rating: 3, reviewed_at: '2026-11-03T02:00:01.000Z' }] });
  out.reviews = { status: rv.status, applied: rv.body.applied };
  return out;
}

test('오늘 공부에 넣기 · 기사 낱말 바로 넣기 · 활용형 찾기 · 연습 다시 받기 — D1·Postgres 같은 결과', async () => {
  const a = await run(fakeD1());
  const b = await run(await pgDb());
  assert.deepEqual(a, b);
  assert.deepEqual(a.lookupBehoerden, ['Behörde']);
  assert.equal(a.lookupNone, 0);
  assert.equal(a.reviewFirst, 'review');
  assert.equal(a.reviewAgain, 'already');
  assert.equal(a.dueHasW1, true);
  assert.equal(a.freshMode, 'already');
  assert.equal(a.freshLate, 'new');
  assert.equal(a.woke, 'review');
  assert.equal(a.unknown, 404);
  assert.deepEqual(a.add, { created: true, mode: 'new' });
  assert.deepEqual(a.added, {
    lemma: 'einleiten', pos: 'verb', level: 'B2', level_src: 'mine', gloss_ko: '시작하다',
    example_de: 'Die Behörden haben eine Prüfung eingeleitet.', example_ko: '당국이 점검을 시작했다.', example_src: 'article:1', pinned: 1,
  });
  assert.deepEqual(a.req, { text: 'einleiten', status: 'added', note: '기사에서 바로' });
  assert.equal(a.freshFirst, true, a.freshIds.join(','));
  assert.deepEqual(a.freshIds, ['einleiten', 'Zulassung', 'Prüfung']);
  assert.deepEqual(a.addAgain, { created: false, mode: 'already', same: true });
  assert.equal(a.notInLesson, 400);
  assert.equal(a.practice1, 1);
  assert.equal(a.practice2, 0);
  assert.equal(a.practiceRows, 1);
  assert.deepEqual(a.reviews, { status: 200, applied: 1 });
});

test('lemmaCandidates: 복수·활용 어미 · 과거분사 · 분리동사 · zu 부정사', () => {
  const has = (form, lemma) => assert.ok(lemmaCandidates(form).includes(lemma), `${form} → ${lemma}: ${lemmaCandidates(form).join(',')}`);
  has('Behörden', 'Behörde');
  has('eingeleitet', 'einleiten');
  has('gemacht', 'machen');
  has('gearbeitet', 'arbeiten');
  has('einzuleiten', 'einleiten');
  has('arbeitete', 'arbeiten');
  has('Häuser', 'Häuser');
  assert.deepEqual(lemmaCandidates('a'), []);
});

// ── 세션: 소개 카드 → 몇 장 뒤 퀴즈 ──
const NOW = new Date('2026-11-03T03:00:00Z');
const GL = ['결정', '계약', '환경', '습관', '건물', '경험', '이사', '연착'];
const item = (i, state = 0) => ({
  word: { id: `w${i}`, lemma: `Wort${String.fromCharCode(65 + i)}${'x'.repeat(i)}`, pos: 'noun', gender: 'die', plural: null, ipa: null, level: 'B1', gloss_en: null, gloss_ko: GL[i], example_de: null, example_ko: null, example_hit: null, image: false, seq: i },
  card: { word_id: `w${i}`, state, due: NOW.toISOString(), stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, last_review: null, introduced_at: null, suspended: 0 },
});
const POOL = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, lemma: `Pool${i}word`, pos: 'noun', gender: 'der', gloss_ko: `보기${i}` }));

test('새 단어: 소개 카드 「다음」 → 채점 없이 몇 장 뒤로, 다시 오면 소개 없이 퀴즈', () => {
  const queue = Array.from({ length: 8 }, (_, i) => item(i));
  let s = initDeck(queue, 1, '2026-11-03T19:00:00.000Z');
  const ctx = () => ({ pool: POOL, introduced: s.introduced, now: NOW, rand: () => 0.4 });
  const first = planStep(s.queue, s.index, ctx());
  assert.equal(first.intro, true);
  s = deckReducer(s, { type: 'introduce' });
  assert.equal(s.pending.length, 0, '소개는 채점 안 함');
  assert.equal(s.index, 1);
  const back = s.queue.findIndex((it, k) => k > 0 && it.word.id === 'w0');
  assert.equal(back, 6, '5장 뒤에 다시');
  // 다음 카드는 다른 새 단어의 소개
  assert.equal(planStep(s.queue, s.index, ctx()).items[0].word.id, 'w1');
  // w0 차례가 오면 소개 없이 퀴즈
  const st = planStep(s.queue, back, ctx());
  assert.equal(st.items[0].word.id, 'w0');
  assert.equal(st.intro, false);
  assert.ok(st.q, '퀴즈 문제');
  // 되돌리기면 소개 표시도 되돌아간다
  const u = deckReducer(s, { type: 'undo' });
  assert.deepEqual(u.introduced, {});
});

test('새 단어 하나뿐이면 소개 뒤 바로 퀴즈(줄 끝) — 끝까지 채점됨', () => {
  let s = initDeck([item(0)], 1, '2026-11-03T19:00:00.000Z');
  s = deckReducer(s, { type: 'introduce' });
  assert.equal(s.finished, false);
  const st = planStep(s.queue, s.index, { pool: POOL, introduced: s.introduced, now: NOW, rand: () => 0.4 });
  assert.equal(st.intro, false);
  s = deckReducer(s, { type: 'grade', rating: 3, at: NOW.toISOString() });
  assert.equal(s.pending.length, 1);
});
