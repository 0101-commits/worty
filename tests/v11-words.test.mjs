// v11 W1~W5(2026-11-02): 단어 들일 때 꼬리표·여성형·뻔한 합성어 거르기, 레벨 투표
import test from 'node:test';
import assert from 'node:assert/strict';
import { entryFlags, buildIndex } from '../scripts/words/sources.mjs';
import { feminineOf, levelVote, pickCandidates, plainCompound, rankLevel } from '../scripts/words/lib.mjs';

test('entryFlags: 모든 뜻에 붙은 꼬리표만, 영어 차용', () => {
  assert.deepEqual(entryFlags({ senses: [{ glosses: ['apricot'], tags: ['Austria'] }] }), ['region']);
  assert.deepEqual(entryFlags({ senses: [{ glosses: ['tomato'], raw_tags: ['Austrian'] }, { glosses: ['x'], tags: ['Austria', 'colloquial'] }] }), ['region']);
  assert.deepEqual(entryFlags({ senses: [{ glosses: ['a'], tags: ['Austria'] }, { glosses: ['b'] }] }), [], '한 뜻이라도 보통 말');
  assert.deepEqual(entryFlags({ senses: [{ glosses: ['youth'], tags: ['archaic'] }] }), ['old']);
  assert.deepEqual(entryFlags({ senses: [{ glosses: ['get'], tags: ['colloquial'] }] }), [], 'colloquial 은 거르지 않음');
  assert.deepEqual(entryFlags({ senses: [{ glosses: ['special unit'], tags: ['abbreviation'] }] }), ['abbr']);
  assert.deepEqual(entryFlags({ etymology_text: 'Unadapted borrowing from English deadline.', senses: [{ glosses: ['deadline'] }] }), ['en']);
  assert.deepEqual(entryFlags({ senses: [] }), []);
});

test('buildIndex: 꼬리표 fl 은 동음 표제어 모두에 있을 때만', async () => {
  const lines = [
    JSON.stringify({ word: 'Marille', pos: 'noun', senses: [{ glosses: ['apricot'], tags: ['feminine', 'Austria'] }] }),
    JSON.stringify({ word: 'Bank', pos: 'noun', senses: [{ glosses: ['bench'], tags: ['feminine', 'dated'] }] }),
    JSON.stringify({ word: 'Bank', pos: 'noun', senses: [{ glosses: ['bank'], tags: ['feminine'] }] }),
  ];
  const ix = await buildIndex({ kaikkiLines: lines, daflexText: '"word"\t"tag"\n', leipzigText: '1\tMarille\t9\n2\tBank\t9\n', month: '2026-11' });
  assert.deepEqual(ix.facts['Marille|noun'].fl, ['region']);
  assert.equal(ix.facts['Bank|noun'].fl, undefined);
  assert.equal(ix.v, 3);
});

test('feminineOf: -in 여성형 + 남성형 명사 있음', () => {
  const index = { facts: { 'Mörder|noun': { g: ['der'] }, 'Arzt|noun': { g: ['der'] }, 'Term|noun': { g: ['der'] } } };
  assert.equal(feminineOf('Mörderin', { g: ['die'] }, index), true);
  assert.equal(feminineOf('Ärztin', { g: ['die'] }, index), true);
  assert.equal(feminineOf('Termin', { g: ['der'] }, index), false, '남성 명사 Termin 은 아님');
  assert.equal(feminineOf('Medizin', { g: ['die'] }, index), false);
});

test('plainCompound: 두 부분이 흔한 아는 낱말일 때만', () => {
  const index = {
    facts: { 'Montag|noun': {}, 'Abend|noun': {}, 'Steuer|noun': {}, 'Erhöhung|noun': {}, 'Arbeit|noun': {}, 'Platz|noun': {} },
    daflex: { montag: 'A1', abend: 'A1', arbeit: 'A1', platz: 'A1' },
    leipzig: { 'Montag|noun': 500, 'Abend|noun': 700, 'Steuer|noun': 900, 'Erhöhung|noun': 2500, 'Arbeit|noun': 100, 'Platz|noun': 400 },
  };
  assert.equal(plainCompound('Montagabend', index, new Set()), true);
  assert.equal(plainCompound('Arbeitsplatz', index, new Set()), true, '이음 글자 s');
  assert.equal(plainCompound('Steuererhöhung', index, new Set()), false, '덱에 없고 A1·A2 도 아님');
  assert.equal(plainCompound('Steuererhöhung', index, new Set(['steuer|noun', 'erhöhung|noun'])), true, '둘 다 덱에 있음');
});

test('rankLevel · levelVote', () => {
  assert.equal(rankLevel(null), null);
  assert.equal(rankLevel(2000), 'B1');
  assert.equal(rankLevel(8000), 'B2');
  assert.equal(rankLevel(15000), 'C1');
  assert.equal(levelVote(['B2', 'B2', 'C1']), 'B2');
  assert.equal(levelVote([null, 'B2', 'B2']), 'B2');
  assert.equal(levelVote(['B1', 'C1', 'B2']), 'B2', '모두 다르면 AI');
  assert.equal(levelVote([null, 'C1', 'A2']), 'C1', 'AI 가 범위 밖이면 있는 값');
  assert.equal(levelVote([null, null, null]), 'C1');
});

test('pickCandidates: 꼬리표·여성형·합성어 거르고 레벨은 등급표 → 순위', () => {
  const index = {
    forms: {}, fn: [],
    facts: {
      'Marille|noun': { g: ['die'], fl: ['region'] }, 'Mörderin|noun': { g: ['die'] }, 'Mörder|noun': { g: ['der'] },
      'Montagabend|noun': { g: ['der'] }, 'Montag|noun': { g: ['der'] }, 'Abend|noun': { g: ['der'] }, 'Sanierung|noun': { g: ['die'] },
    },
    daflex: { montag: 'A1', abend: 'A1' },
    leipzig: { 'Marille|noun': 9000, 'Mörderin|noun': 9000, 'Montagabend|noun': 9000, 'Montag|noun': 500, 'Abend|noun': 700, 'Sanierung|noun': 6000 },
  };
  const out = pickCandidates({ index, have: new Set(['mörder|noun']), skips: new Set(), hits: new Map(), max: 10 });
  assert.deepEqual(out.map((c) => c.key), ['Sanierung|noun']);
  assert.equal(out[0].level, 'B2', '등급표에 없으면 순위로(예전엔 C1)');
});

test('level-audit: 최근 N일만 · 한 줄 요약(W6)', async () => {
  const { recentOnly, auditLine } = await import('../scripts/words/level-audit.mjs');
  const now = new Date('2026-12-02T00:00:00Z');
  const ws = [{ id: 'a', created_at: '2026-11-20 10:00:00' }, { id: 'b', created_at: '2026-09-01 10:00:00' }, { id: 'c', created_at: null }];
  assert.deepEqual(recentOnly(ws, 35, now).map((w) => w.id), ['a']);
  assert.equal(auditLine([{ lemma: 'X', ai_lv: 'C2' }, { lemma: 'Y', ai_lv: 'B2' }]), '새 단어 2개 중 범위 밖 1개 — X(C2)');
});
