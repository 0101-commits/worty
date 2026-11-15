import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from '../scripts/imgcheck.mjs';

const clean = { edgeWhite: 0.95, top4: 0.95, black: 0.05 };

test('imgcheck: OCR 한 글자(그려 넣은 ? ! 오독)는 통과, 두 글자부터 탈락', () => {
  assert.deepEqual(verdict(clean, 0), []);
  assert.deepEqual(verdict(clean, 1), []);
  assert.deepEqual(verdict(clean, 2), ['text 2']);
  assert.deepEqual(verdict(clean, null), []);
});

test('흰 바탕 기준은 꺼져 있다(11-15 결정): 배경이 가장자리까지 차도 다른 항목이 맞으면 통과', () => {
  assert.deepEqual(verdict({ edgeWhite: 0.2, top4: 0.95, black: 0.05 }, 0), []);
  assert.deepEqual(verdict({ edgeWhite: 0.2, top4: 0.8, black: 0.05 }, 0), ['colors 0.8']);
});
