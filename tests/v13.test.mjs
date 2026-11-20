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
