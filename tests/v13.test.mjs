// v13 개선(2026-11-20): 알림 시계 멈춤 다시 맞추기 · 그 밖 v13 과제 순수 함수
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alarmStuck, ALARM_STUCK_MS } from '../worker/time.ts';

test('L1 알림 시계: 15분 넘게 지난 알람만 멈춤으로 본다', () => {
  const now = Date.parse('2026-11-20T05:40:00Z');
  assert.equal(alarmStuck(null, now), false);
  assert.equal(alarmStuck(now + 60_000, now), false); // 앞으로 울릴 알람
  assert.equal(alarmStuck(now - 60_000, now), false); // 막 울리는 중일 수 있음
  assert.equal(alarmStuck(now - ALARM_STUCK_MS - 1, now), true);
  assert.equal(alarmStuck(Date.parse('2026-11-02T22:30:00Z'), now), true); // 11-03~11-20 실제 멈춤
});

import { alarmLines, jobLines } from '../scripts/summary.mjs';

test('G2 아침 요약: 작업 줄은 실패를 앞에 ✗ 로, 취소·자기 자신은 뺀다', () => {
  const runs = [
    { path: '.github/workflows/kaggle-draw.yml', status: 'completed', conclusion: 'failure', html_url: 'u1' },
    { path: '.github/workflows/kaggle-draw.yml', status: 'completed', conclusion: 'success' },
    { path: '.github/workflows/daily.yml', status: 'completed', conclusion: 'success' },
    { path: '.github/workflows/daily.yml', status: 'completed', conclusion: 'cancelled' },
    { path: '.github/workflows/words.yml', status: 'in_progress', conclusion: null },
    { path: '.github/workflows/summary.yml', status: 'in_progress', conclusion: null },
  ];
  assert.deepEqual(jobLines(runs), ['✓ daily 1', '✗ kaggle-draw 1 · 실패 1 u1', '✓ words 0 · 도는 중 1']);
});

test('G2 아침 요약: 알림 시계 멈춤·실패는 ✗', () => {
  const ok = alarmLines({ next: '2026-11-20T12:00:00Z', last: { at: '2026-11-19T22:30:00Z', kind: 'morning', result: 'sent' } }, []);
  assert.equal(ok[0], '✓ 마지막 울림: morning 11-20 07:30 sent · 다음 11-20 21:00');
  const healed = alarmLines({ next: '2026-11-20T12:00:00Z', healed: '2026-11-02T22:30:00Z' }, [{ kind: 'morning', day: '2026-11-02', status: 'sent' }]);
  assert.match(healed[0], /^✗ 알림 시계 멈춤\(11-03 07:30\) → 다시 맞춤/);
  assert.match(healed.at(-1), /morning 2026-11-02 sent/);
  assert.match(alarmLines({ next: 'x', last: { at: '2026-11-19T22:30:00Z', kind: 'morning', result: 'error:boom' } }, [])[0], /^✗/);
});

import { deckReducer, initDeck, remaining } from '../src/deck.ts';

test('U2 진행 표시: 소개 뒤 퀴즈가 붙어도 남은 낱말 수는 늘지 않는다', () => {
  const item = (id) => ({ word: { id }, card: { word_id: id, state: 0, due: '2026-11-20T00:00:00Z' } });
  let s = initDeck(['a', 'b', 'c'].map(item));
  assert.deepEqual(remaining(s), { left: 3, total: 3 });
  s = deckReducer(s, { type: 'introduce' }); // a 를 몇 장 뒤로(퀴즈) — 줄은 4장
  assert.equal(s.queue.length, 4);
  assert.deepEqual(remaining(s), { left: 3, total: 3 });
  s = deckReducer(s, { type: 'skip' });
  assert.deepEqual(remaining(s), { left: 2, total: 3 });
});

import { SHY, hyphenate, partBreaks, pieces } from '../src/hyphen.ts';

test('U1 끊는 자리: 합성어 풀이가 있으면 그 경계(이음 s 는 앞에), 없으면 음절', () => {
  const show = (s) => s.replaceAll(SHY, '|');
  const parts = [{ p: 'Geschwindigkeit', ko: '속도' }, { p: 's', link: true }, { p: 'Beschränkung', ko: '제한' }];
  assert.equal(show(hyphenate('Geschwindigkeitsbeschränkung', parts, 'parts')), 'Geschwindigkeits|beschränkung');
  assert.deepEqual(partBreaks('Geschwindigkeitsbeschränkung', [{ p: 'Geschwindigkeit' }, { p: 'Beschränkung' }]), []); // 이어 붙여도 안 같으면 버림
  assert.equal(show(hyphenate('Bundesverfassungsgericht')), 'Bun|des|ver|fas|sungs|ge|richt');
  assert.equal(show(hyphenate('verschreibungspflichtig')), 'ver|schrei|bungs|pflich|tig');
  assert.equal(show(hyphenate('Rechtsanwaltskanzlei')), 'Rechts|an|walts|kanz|lei');
  assert.equal(hyphenate('Umzug'), 'Umzug'); // 짧은 낱말은 그대로
  assert.equal(show(hyphenate('den Nagel auf den Kopf treffen')), 'den Nagel auf den Kopf treffen');
  assert.deepEqual(pieces(hyphenate('Geschwindigkeitsbeschränkung', parts, 'parts')), ['Geschwindigkeits', 'beschränkung']);
});

import { acceptParts } from '../scripts/words/lib.mjs';

test('L4 합성어 풀이: 이어 붙여 표제어와 같은 답만 받는다', () => {
  const list = [
    { id: 'w1', lemma: 'Geschwindigkeitsbeschränkung' },
    { id: 'w2', lemma: 'Verhandlung' },
    { id: 'w3', lemma: 'Bundesverfassungsgericht' },
    { id: 'w4', lemma: 'Arbeitslosigkeit' },
    { id: 'w5', lemma: 'den Nagel auf den Kopf treffen' },
  ];
  const got = acceptParts(
    [
      { id: 'w1', parts: [{ p: 'Geschwindigkeit', ko: '속도' }, { p: 's', link: true }, { p: 'Beschränkung', ko: '제한' }] },
      { id: 'w2', parts: [] },
      { id: 'w3', parts: [{ p: 'Bund', ko: '연방' }, { p: 'Verfassung', ko: '헌법' }, { p: 'Gericht', ko: '법원' }] }, // es · s 빠짐 → 안 받음
      { id: 'w4', parts: [{ p: 'Arbeit', ko: '일' }, { p: 'slosigkeit', link: true }] }, // 이음 글자가 아님 → 안 받음
      { id: 'w5', parts: [] }, // 숙어는 안 받음
    ],
    list,
  );
  assert.deepEqual(got.get('w1'), [{ p: 'Geschwindigkeit', ko: '속도' }, { p: 's', link: true }, { p: 'Beschränkung', ko: '제한' }]);
  assert.deepEqual(got.get('w2'), []);
  assert.equal(got.has('w3'), false);
  assert.equal(got.has('w4'), false);
  assert.equal(got.has('w5'), false);
});

import { paceOf } from '../worker/deck.ts';
import { minutesFor } from '../src/session.ts';

test('U3 장당 시간: 세션 시간 ÷ 본 카드 수, 3분 넘는 멈춤은 세션 경계', () => {
  const rows = [];
  // 세션 1: 카드 20장을 10초 간격(같은 카드 한 번 다시) → 200초 · 20장
  for (let i = 0; i <= 20; i++) rows.push({ t: i * 10_000, w: `w${i % 20}` });
  // 1시간 쉼 뒤 세션 2: 10장 5초 간격 → 45초 · 10장
  for (let i = 0; i < 10; i++) rows.push({ t: 3_600_000 + i * 5000, w: `x${i}` });
  assert.equal(paceOf(rows), Math.round((245 / 30) * 10) / 10);
  assert.equal(paceOf(rows.slice(0, 5)), null); // 자료가 적으면 null
  assert.equal(minutesFor(20, 8), 3);
  assert.equal(minutesFor(20, null), 2); // 예전 셈(6초)
});

import { fakeD1, addWord, lem } from './d1.mjs';
import { REST_DUE_CAP, buildToday, loadSettings } from '../worker/deck.ts';

test('L2 쉰 다음 날: 복습은 40장까지(잊어 가는 카드 먼저) · 복습이 넘치면 새 단어 0 · 어제 공부했으면 그대로', async () => {
  const NOON = new Date('2026-10-26T03:00:00Z'); // 학습일 10-26
  const make = (dueN, lastReview) => {
    const db = fakeD1();
    for (let i = 1; i <= 6; i++) addWord(db, { id: `n${i}`, lemma: lem(i), seq: i });
    for (let i = 1; i <= dueN; i++) addWord(db, { id: `r${i}`, lemma: `Alt${i}`, seq: 100 + i, state: 2, due: '2026-10-25T23:00:00.000Z', introduced_at: '2026-10-01T00:00:00.000Z' });
    db.raw.prepare("UPDATE cards SET last_review = '2026-10-20T03:00:00.000Z', stability = 5 WHERE state = 2").run();
    db.raw.prepare('INSERT INTO reviews(word_id, rating, reviewed_at) VALUES (?, 3, ?)').run('n1', lastReview);
    return db;
  };
  const s = async (db) => ({ ...(await loadSettings(db)), new_per_day: 4 });
  // 마지막 공부 10-24(어제 10-25 쉼) · 복습 60 → 40장 + 미룬 20 · 새 단어 0
  let db = make(60, '2026-10-24T03:00:00.000Z');
  let t = await buildToday(db, await s(db), NOON);
  assert.equal(t.due.length, REST_DUE_CAP);
  assert.equal(t.plan.deferred, 20);
  assert.equal(t.fresh.length, 0);
  // 쉰 다음 날이어도 복습이 상한 안이면 새 단어는 그대로
  db = make(10, '2026-10-24T03:00:00.000Z');
  t = await buildToday(db, await s(db), NOON);
  assert.equal(t.due.length, 10);
  assert.equal(t.plan.deferred, undefined);
  assert.equal(t.fresh.length, 4);
  // 어제(10-25 학습일) 공부했으면 상한 없음
  db = make(60, '2026-10-25T03:00:00.000Z');
  t = await buildToday(db, await s(db), NOON);
  assert.equal(t.due.length, 60);
  assert.equal(t.plan.deferred, undefined);
});

import { withGroups } from '../src/wordsFilter.ts';

test('U5 · L5 단어 목록 묶음: 배우는 중 → 다음 30일 → 1년 안 → 그 뒤(거르기 중엔 없음)', () => {
  const it = (i, learning) => ({ word: { id: `w${i}` }, card: { state: learning ? 2 : 0, introduced_at: learning ? 'x' : null } });
  const items = [it(0, true), it(1, true), ...Array.from({ length: 400 }, (_, i) => it(2 + i, false))];
  const heads = withGroups(items, true, { weak: 0, week: 0, learning: 2, new_per_day: 1 }).flatMap((x, i) => (x.head ? [[i, x.head]] : []));
  assert.deepEqual(heads, [
    [0, '배우는 중 2개'],
    [2, '다음 30일에 배울 단어 30개'],
    [32, '1년 안에 배울 단어 335개'],
    [367, '그 뒤 · 지금 속도로 1년 넘게 걸리는 단어'],
  ]);
  assert.equal(withGroups(items, false, null).some((x) => x.head), false);
});

test('L2 쉰 다음 날: 오늘 틀린 카드는 미룬 카드에 밀려나지 않고, 오늘 본 복습 카드는 40장을 넘지 않는다', async () => {
  const NOON = new Date('2026-10-26T03:00:00Z');
  const db = fakeD1();
  for (let i = 1; i <= 60; i++) addWord(db, { id: `r${i}`, lemma: `Alt${i}`, seq: 100 + i, state: 2, due: '2026-10-25T23:00:00.000Z', introduced_at: '2026-10-01T00:00:00.000Z' });
  db.raw.prepare("UPDATE cards SET last_review = '2026-10-20T03:00:00.000Z', stability = 5").run();
  db.raw.prepare("INSERT INTO reviews(word_id, rating, reviewed_at) VALUES ('r1', 3, '2026-10-24T03:00:00.000Z')").run(); // 10-25 쉼
  const at = '2026-10-26T01:00:00.000Z';
  // 오늘 30장 O(다음 볼 때 먼 날) · 5장 X(오늘 다시 — 다시 익히는 중 state 3, 마감 몇 분 뒤)
  for (let i = 1; i <= 35; i++) {
    const x = i > 30;
    db.raw.prepare('UPDATE cards SET state = ?, due = ?, last_review = ?, stability = ? WHERE word_id = ?')
      .run(x ? 3 : 2, x ? '2026-10-26T01:10:00.000Z' : '2026-11-20T00:00:00.000Z', at, x ? 0.5 : 20, `r${i}`);
    db.raw.prepare('INSERT INTO reviews(word_id, rating, reviewed_at) VALUES (?, ?, ?)').run(`r${i}`, x ? 1 : 3, at);
  }
  const t = await buildToday(db, { ...(await loadSettings(db)), new_per_day: 4 }, NOON);
  const ids = t.due.map((i) => i.word.id);
  for (let i = 31; i <= 35; i++) assert.ok(ids.includes(`r${i}`), `틀린 r${i} 가 남아야 함`);
  assert.equal(t.plan.done + t.due.length, REST_DUE_CAP); // 30 끝냄 + 5 틀림 + 5 새로 = 40
  assert.equal(t.plan.deferred, 20);
});
