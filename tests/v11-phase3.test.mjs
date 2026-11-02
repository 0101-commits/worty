// v11 3단계(단어 · 기록): 움라우트 무시 검색, 단어 거르기, 기록 질의, 제외. 두 DB 비교는 pg-backend.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { fakeD1, addWord } from './d1.mjs';
import { foldDe, foldSql, searchTerm, stripArticle } from '../shared/search.ts';
import { weekStart } from '../worker/stats.ts';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject { constructor(s, e) { this.ctx = s; this.env = e; } }', shortCircuit: true };
  return next(spec, ctx);
}`));
crypto.subtle.timingSafeEqual ??= (a, b) => Buffer.from(a).equals(Buffer.from(b));
const { default: worker } = await import('../worker/index.ts');

test('검색어 풀기: ae=ä oe=ö ue=ü ss=ß, 앞 der/die/das/sich 무시', () => {
  assert.equal(foldDe('Ärger'), 'aerger');
  assert.equal(foldDe('äußern'), 'aeussern');
  assert.equal(foldDe('Straße'), 'strasse');
  assert.equal(foldDe('grüßen'), 'gruessen');
  assert.equal(foldDe('Ärger'), foldDe('aerger'));
  assert.equal(stripArticle('die Entscheidung'), 'Entscheidung');
  assert.equal(stripArticle('  Der   Vertrag '), 'Vertrag');
  assert.equal(stripArticle('sich freuen'), 'freuen');
  assert.equal(stripArticle('der'), 'der', '관사만 쳤으면 그대로');
  assert.equal(stripArticle('dasselbe'), 'dasselbe', '관사로 시작하는 낱말은 안 뗌');
  assert.equal(searchTerm('Die Größe'), 'groesse');
});

test('foldSql: 표제어 칸을 같은 식으로(대문자 움라우트 포함)', () => {
  const db = fakeD1();
  for (const [lemma, want] of [['Ärger', 'aerger'], ['Öl', 'oel'], ['Übung', 'uebung'], ['Straße', 'strasse'], ['Haus', 'haus']]) {
    assert.equal(db.raw.prepare(`SELECT ${foldSql('?')} AS f`).get(lemma).f, want);
  }
});

test('weekStart: 월요일 시작', () => {
  assert.equal(weekStart('2026-11-02'), '2026-11-02'); // 월
  assert.equal(weekStart('2026-11-08'), '2026-11-02'); // 일
  assert.equal(weekStart('2026-11-04'), '2026-11-02');
});

const DAY = 86_400_000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const env = (db) => ({ DB: db, IMG: { get: async () => null, put: async () => undefined }, API_TOKEN: 't', APP_URL: 'https://x.test', SCHED: { idFromName: () => 'x', get: () => ({ ensure: async () => ({}), later: async () => ({ ok: true }) }) } });
async function call(db, method, path, body) {
  const init = { method, headers: { authorization: 'Bearer t', 'content-type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await worker.fetch(new Request('https://x.test' + path, init), env(db), { waitUntil() {} });
  return { status: res.status, body: await res.json() };
}
const lemmas = (r) => r.body.items.map((x) => x.word.lemma).sort();

function seed() {
  const db = fakeD1();
  const a = (w, card = {}) => {
    addWord(db, { ...w, state: card.state ?? 0, introduced_at: card.introduced_at ?? null, due: card.due ?? iso(-DAY) });
    if (card.lapses != null || card.suspended) db.raw.prepare('UPDATE cards SET lapses = ?, suspended = ? WHERE word_id = ?').run(card.lapses ?? 0, card.suspended ?? 0, w.id);
  };
  a({ id: 'w1', lemma: 'Ärger', gender: 'der', gloss_ko: '화', seq: 1 }, { state: 2, introduced_at: iso(-2 * DAY), lapses: 3 });
  a({ id: 'w2', lemma: 'Straße', gender: 'die', gloss_ko: '길', seq: 2, image_status: 'ok' }, { state: 2, introduced_at: iso(-30 * DAY), lapses: 2 });
  a({ id: 'w3', lemma: 'sich freuen', pos: 'verb', gloss_ko: '기뻐하다', seq: 3 }, { state: 1, introduced_at: iso(-1 * DAY), lapses: 1 });
  a({ id: 'w4', lemma: 'Entscheidung', gender: 'die', level: 'B2', gloss_ko: '결정', seq: 4, image_status: 'ok' }, { suspended: 1 });
  a({ id: 'w5', lemma: 'Vertrag', gender: 'der', gloss_ko: '계약', seq: 5 });
  return db;
}

test('/api/words: 움라우트 무시 · 앞 관사 무시 · 한국어 뜻', async () => {
  const db = seed();
  assert.deepEqual(lemmas(await call(db, 'GET', '/api/words?q=aerger')), ['Ärger']);
  assert.deepEqual(lemmas(await call(db, 'GET', '/api/words?q=%C3%84rger')), ['Ärger']);
  assert.deepEqual(lemmas(await call(db, 'GET', '/api/words?q=strasse')), ['Straße']);
  assert.deepEqual(lemmas(await call(db, 'GET', '/api/words?q=die%20Entscheid')), ['Entscheidung']);
  assert.deepEqual(lemmas(await call(db, 'GET', '/api/words?q=freuen')), ['sich freuen']);
  assert.deepEqual(lemmas(await call(db, 'GET', '/api/words?q=sich%20freu')), ['sich freuen']);
  assert.deepEqual(lemmas(await call(db, 'GET', '/api/words?q=' + encodeURIComponent('계약'))), ['Vertrag']);
  assert.equal((await call(db, 'GET', '/api/words?q=%25')).body.items.length, 0, '% 는 글자 그대로');
});

test('/api/words: 품사 · 그림 · 자주 틀림 · 이번 주 · 제외 거르기와 틀린 순', async () => {
  const db = seed();
  assert.deepEqual(lemmas(await call(db, 'GET', '/api/words?pos=verb')), ['sich freuen']);
  assert.deepEqual(lemmas(await call(db, 'GET', '/api/words?image=yes')), ['Entscheidung', 'Straße']);
  assert.equal((await call(db, 'GET', '/api/words?image=no')).body.items.length, 3);
  const weak = await call(db, 'GET', '/api/words?weak=1&sort=weak');
  assert.deepEqual(weak.body.items.map((x) => x.word.lemma), ['Ärger', 'Straße'], '많이 틀린 순');
  assert.deepEqual(lemmas(await call(db, 'GET', '/api/words?week=1')), ['sich freuen', 'Ärger']);
  assert.deepEqual(lemmas(await call(db, 'GET', '/api/words?state=suspended')), ['Entscheidung']);
});

test('/api/words/counts · 제외 · 상세 O/X', async () => {
  const db = seed();
  assert.deepEqual((await call(db, 'GET', '/api/words/counts')).body, { weak: 2, week: 2 });
  assert.equal((await call(db, 'POST', '/api/word/w5/suspend', { suspended: true })).status, 200);
  assert.equal(db.raw.prepare("SELECT suspended, suspended_at FROM cards WHERE word_id = 'w5'").get().suspended, 1);
  assert.equal((await call(db, 'POST', '/api/word/w5/suspend', { suspended: false })).body.suspended, false);
  assert.equal((await call(db, 'POST', '/api/word/zzz/suspend', { suspended: true })).status, 404);
  assert.equal((await call(db, 'POST', '/api/word/w5/suspend', { suspended: 'x' })).status, 400);
  const ins = db.raw.prepare('INSERT INTO reviews(word_id, rating, reviewed_at, session_id, undone) VALUES (?, ?, ?, ?, ?)');
  ins.run('w1', 3, iso(-DAY), 's', 0);
  ins.run('w1', 4, iso(-DAY + 1000), 's', 0);
  ins.run('w1', 1, iso(-DAY + 2000), 's', 0);
  ins.run('w1', 1, iso(-DAY + 3000), 's', 1); // 되돌린 채점은 뺀다
  const d = await call(db, 'GET', '/api/word/w1');
  assert.deepEqual(d.body.ox, { o: 2, x: 1 });
});

test('/api/stats/records: 이번 주 · 달력 · 자주 틀린 단어 · 복습 예정 · 진도', async () => {
  const db = seed();
  const ins = db.raw.prepare('INSERT INTO reviews(word_id, rating, reviewed_at, session_id, undone) VALUES (?, ?, ?, ?, 0)');
  const now = Date.now();
  for (let k = 0; k < 4; k++) ins.run('w1', k === 0 ? 1 : 3, new Date(now - k * 1000).toISOString(), 's'); // 지금(오늘 학습일) 4번, X 1
  const r = (await call(db, 'GET', '/api/stats/records')).body;
  assert.equal(r.week.reviews, 4);
  assert.equal(r.week.correct, 3);
  assert.equal(r.week.days, 1);
  assert.equal(r.month.days.at(-1).count, 4, '달력 마지막 칸 = 오늘');
  assert.equal(r.month.days[0].day.slice(8), '01');
  assert.deepEqual(r.weak.map((w) => [w.lemma, w.x]), [['Ärger', 3], ['Straße', 2]]);
  assert.equal(r.forecast.length, 7);
  assert.equal(r.forecast[0].count, 3, '밀린 복습 카드(w1 w2 w3)는 오늘에');
  assert.equal(r.forecast.reduce((a, x) => a + x.count, 0), 3);
  assert.deepEqual(r.progress.B1, { learned: 3, total: 4 });
  assert.deepEqual(r.progress.B2, { learned: 0, total: 1 });
  assert.deepEqual(r.progress.C1, { learned: 0, total: 0 });
});
