import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeWhy } from '../scripts/judge-why.mjs';

test('judgeWhy: 객관식에서 떨어지면 이유 글이 「맞다」여도 걸린 항목을 앞에 붙인다', () => {
  const v = { why: 'puzzle pieces and gears represent Verstand', key_visible: true, guessable: true, body_ok: true, text_ok: true, mcq: [true, false], ok: false };
  assert.equal(judgeWhy(v), 'judge[객관식 1/2]: puzzle pieces and gears represent Verstand');
});

test('judgeWhy: 여러 항목이 걸리면 모두 적는다', () => {
  const v = { why: 'dog stands', key_visible: false, guessable: false, body_ok: true, text_ok: false, mcq: [false, false], ok: false };
  assert.equal(judgeWhy(v), 'judge[객관식 0/2 · 핵심 물체✗ · 알아맞히기✗ · 글자·틀✗]: dog stands');
});

test('judgeWhy: 화소 검사 탈락·판정 없음·잘린 답', () => {
  assert.equal(judgeWhy({ ok: false, why: 'pixel: edge_white 0.5', pixel: true }), 'judge: pixel: edge_white 0.5');
  assert.equal(judgeWhy(undefined), 'judge: null');
  assert.equal(judgeWhy({ ok: false, why: 'truncated', guessable: false }), 'judge[알아맞히기✗]: truncated');
});
