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
