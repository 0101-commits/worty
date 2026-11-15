// Kaggle 판정 탈락 이유 한 줄(scripts/kaggle.mjs collect 가 쓴다). kaggle.mjs 는 불러오면 명령을 실행하므로 시험할 수 있게 따로 둔다
/** 판정 탈락 이유 한 줄. why(모델이 쓴 글)는 그림 묘사라 「맞다」처럼 읽히기도 해서, 실제로 걸린 항목을 앞에 붙인다.
 *  최종 ok = 객관식 두 번 다 맞힘 && key_visible && guessable && body_ok && text_ok (kaggle/draw.py ask) */
export function judgeWhy(v) {
  const text = String(v?.why ?? 'null').slice(0, 120);
  if (!v || v.pixel) return `judge: ${text}`;
  const tags = [];
  if (Array.isArray(v.mcq) && !v.mcq.every(Boolean)) tags.push(`객관식 ${v.mcq.filter(Boolean).length}/${v.mcq.length}`);
  for (const [k, name] of [['key_visible', '핵심 물체'], ['guessable', '알아맞히기'], ['body_ok', '몸'], ['text_ok', '글자·틀']]) if (v[k] === false) tags.push(`${name}✗`);
  return `judge${tags.length ? `[${tags.join(' · ')}]` : ''}: ${text}`;
}
