-- Wortling 0014: 합성어 풀이(v13 L4, 2026-11-20). JSON 배열 [{p, ko?, link?}] — 이어 붙이면 lemma 와 같다.
-- NULL = 아직 안 물어봄 · '[]' = 물어봤고 합성어 아님. 매일 단어 작업(scripts/words/parts.mjs)이 채운다.
-- 카드 줄바꿈 자리(src/hyphen.ts) · 뒷면 풀이 줄 · 단어 상세가 쓴다.
ALTER TABLE words ADD COLUMN parts TEXT;
