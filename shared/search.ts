// 단어 검색 정규화(앱·Worker 공용). 움라우트를 푼 글자로 맞춘다: ae = ä · oe = ö · ue = ü · ss = ß.
// 양쪽(검색어·표제어)을 같은 규칙으로 풀어 비교하므로 「Ärger」 · 「aerger」 · 「Aerger」 가 모두 맞는다.

const FOLDS: Array<[string, string]> = [['ä', 'ae'], ['ö', 'oe'], ['ü', 'ue'], ['ß', 'ss']];

/** 소문자 + 움라우트 풀기 */
export function foldDe(s: string): string {
  let out = s.toLowerCase();
  for (const [a, b] of FOLDS) out = out.split(a).join(b);
  return out;
}

/** 검색어 앞의 der/die/das/sich 는 뒤에 글자가 더 있을 때만 뗀다(「der」만 치면 그대로) */
export function stripArticle(q: string): string {
  const t = q.trim().replace(/\s+/g, ' ');
  const m = /^(der|die|das|sich) (.+)$/i.exec(t);
  return m ? m[2] : t;
}

/** 서버로 보낼 검색어: 앞 관사 떼고, 움라우트 풀고 */
export function searchTerm(q: string): string {
  return foldDe(stripArticle(q));
}

/** SQL 에서 표제어 칸을 같은 식으로 푸는 식(lower 는 ASCII 만이라 대문자 움라우트는 직접). col 은 신뢰하는 칸 이름만 */
export function foldSql(col: string): string {
  let e = col;
  for (const [a, b] of [['Ä', 'ae'], ['Ö', 'oe'], ['Ü', 'ue'], ['ä', 'ae'], ['ö', 'oe'], ['ü', 'ue'], ['ß', 'ss']]) e = `replace(${e}, '${a}', '${b}')`;
  return `lower(${e})`;
}
