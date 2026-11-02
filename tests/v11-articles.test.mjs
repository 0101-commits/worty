// v11 4단계: 오늘의 기사 · 저장한 표현 API — D1(node:sqlite 흉내)와 Postgres(PGlite) 두 DB 에서 같은 결과
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { fakeD1 } from './d1.mjs';
import { createPgDb } from '../worker/db.ts';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject { constructor(s, e) { this.ctx = s; this.env = e; } }', shortCircuit: true };
  return next(spec, ctx);
}`));
crypto.subtle.timingSafeEqual ??= (a, b) => Buffer.from(a).equals(Buffer.from(b));
const { default: worker } = await import('../worker/index.ts');
const { kstDay } = await import('../worker/time.ts');

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
  glossary: [{ form: 'eingeleitet', lemma: 'einleiten', pos: 'verb', gloss_ko: '시작하다', level: 'B2' }, { form: 'Behörden', lemma: 'Behörde', pos: 'noun', gloss_ko: '당국', level: 'B1' }],
  expressions: [{ base: 'eine Prüfung einleiten', meaning_ko: '점검을 시작하다', s: 0 }],
  quiz: [],
};

async function run(db) {
  const day = kstDay();
  await db.prepare(`INSERT INTO words(id, lemma, pos, level, level_src, gloss_status, seq, created_at) VALUES ('w0001', 'Behörde', 'noun', 'B1', 'goethe', 'checked', 1, '2026-11-01 00:00:00')`).run();
  await db.prepare(`INSERT INTO cards(word_id, state, due, reps) VALUES ('w0001', 2, '2026-11-10T00:00:00.000Z', 3)`).run();
  const items = [
    { source: 'kbs', ext_id: '1', url: 'https://k/1', title: 'Haupt', category: 'Wirtschaft', published_at: day + 'T01:00:00Z', day, role: 'main', body: 'x', words: 130, score: 1, lesson: LESSON },
    { source: 'kbs', ext_id: '2', url: 'https://k/2', title: 'Extra A', day, role: 'extra', words: 150, score: 0.9, lesson: LESSON },
    { source: 'kbs', ext_id: '3', url: 'https://k/3', title: 'Extra B', day, role: 'extra', words: 150, score: 0.5, lesson: LESSON },
  ];
  const out = {};
  out.put = (await call(db, 'POST', '/api/admin/articles', { items })).body;
  out.put2 = (await call(db, 'POST', '/api/admin/articles', { items: [{ ...items[0], score: 2 }] })).body; // 같은 기사 다시 = 고치기
  const t = (await call(db, 'GET', '/api/articles/today')).body;
  out.today = { title: t.article?.title, is_today: t.is_today, more_left: t.more_left, deck: t.article?.deck, saved: t.article?.saved, lesson: Boolean(t.article?.lesson?.glossary) };
  const id = t.article.id;
  out.more = (await call(db, 'POST', '/api/articles/more')).body.article?.title;
  out.more_left = (await call(db, 'GET', '/api/articles/today')).body.more_left;
  out.prog = (await call(db, 'POST', `/api/articles/${id}/progress`, { done: true, quiz_score: 3 })).body;
  out.list = (await call(db, 'GET', '/api/articles')).body.items.map((x) => [x.title, x.status, Number(x.quiz_score ?? -1)]);
  out.save = (await call(db, 'POST', '/api/expressions', { article_id: id, items: [{ base: 'eine Prüfung einleiten', meaning_ko: '점검을 시작하다', sentence: 'Die …' }, { base: 'eine Prüfung einleiten', meaning_ko: '점검을 시작하다' }] })).body;
  const ex = (await call(db, 'GET', '/api/expressions')).body.items;
  out.expr = ex.map((x) => [x.base, Number(x.state)]);
  out.due = (await call(db, 'GET', '/api/expressions/due?limit=3')).body.items.length;
  out.grade = (await call(db, 'POST', `/api/expressions/${ex[0].id}/grade`, { rating: 3 })).body.state;
  out.bad = (await call(db, 'POST', `/api/expressions/${ex[0].id}/grade`, { rating: 7 })).status;
  out.saved = (await call(db, 'GET', `/api/articles/${id}`)).body.saved;
  const extraB = (await call(db, 'GET', '/api/admin/articles/known?since=2000-01-01')).body.items.find((x) => x.title === 'Extra B');
  out.knownTitle = Boolean(extraB);
  const ids = (await db.prepare(`SELECT id FROM articles WHERE title = 'Extra B'`).first()).id;
  out.bypass = (await call(db, 'POST', `/api/articles/${ids}/progress`, { opened: true })).status; // 아직 안 연 extra 는 한 편 더로만
  out.badAid = (await call(db, 'POST', '/api/expressions', { article_id: 99999, items: [{ base: 'auf etwas abzielen', meaning_ko: '목표로 하다' }] })).status;
  out.badAidNull = (await db.prepare(`SELECT article_id FROM expressions WHERE base = 'auf etwas abzielen'`).first()).article_id;
  out.httpOnly = (await call(db, 'POST', '/api/admin/articles', { items: [{ source: 'kbs', ext_id: '9', url: 'javascript:alert(1)', title: 'x', day: '2026-11-02' }] })).status;
  out.wordArt = (await call(db, 'GET', '/api/word/w0001/articles')).body.items.map((x) => [x.form, x.title]);
  out.wordArtNone = (await call(db, 'GET', '/api/word/w9999/articles')).status;
  out.purge = (await call(db, 'POST', '/api/admin/articles/purge')).body.purged;
  out.known = (await call(db, 'GET', '/api/admin/articles/known?since=2000-01-01')).body.items.length;
  return out;
}

test('기사·표현 API: D1 과 Postgres 결과가 같고 규칙대로', async () => {
  const a = await run(fakeD1());
  const b = await run(await pgDb());
  assert.deepEqual(a, b);
  assert.deepEqual(a.today, { title: 'Haupt', is_today: true, more_left: 2, deck: { Behörde: { id: 'w0001', level: 'B1', learned: true } }, saved: [], lesson: true });
  assert.equal(a.more, 'Extra A', '점수 높은 extra 먼저');
  assert.equal(a.more_left, 1);
  assert.deepEqual(a.list.find((x) => x[0] === 'Haupt'), ['Haupt', 'done', 3]);
  assert.deepEqual(a.expr, [['eine Prüfung einleiten', 0]], '같은 기본꼴은 한 번');
  assert.equal(a.due, 1);
  assert.ok(a.grade >= 1);
  assert.equal(a.bad, 400);
  assert.deepEqual(a.saved, ['eine Prüfung einleiten']);
  assert.equal(a.purge, 0, '30일 안 된 본문은 안 지움');
  assert.equal(a.known, 3);
  assert.equal(a.knownTitle, true, '작업이 최근 기사 제목을 받아 같은 사건을 거른다');
  assert.equal(a.bypass, 409);
  assert.equal(a.badAid, 200);
  assert.equal(a.badAidNull, null, '없는 기사 번호는 null');
  assert.equal(a.httpOnly, 400, 'https 주소만');
  assert.deepEqual(a.wordArt, [['Behörden', 'Extra B'], ['Behörden', 'Extra A'], ['Behörden', 'Haupt']], '기사 속 문장: 낱말 목록의 꼴로, 최근 기사부터 3개');
  assert.equal(a.wordArtNone, 404);
});
