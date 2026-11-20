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
