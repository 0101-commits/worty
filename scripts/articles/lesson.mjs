// 기사 → 공부 자료(lesson JSON) 프롬프트와 검사(v11 4단계). 화면 = 미리보기(요약·핵심 단어) · 본문(문장별 번역·낱말 뜻) · 표현 · 퀴즈 4개.
// AI 답이 모양에 안 맞으면 버린다(다음 실행 때 다시) — 화면이 깨진 자료를 받지 않게.

export function lessonPrompt({ title, sentences }) {
  return `You prepare a short German reading lesson for a Korean learner moving from B1 to C1 (personal flashcard app). The text is a KBS WORLD German news article.
Title: ${title}
Sentences (index: text):
${sentences.map((s, i) => `${i}: ${s}`).join('\n')}

Return a JSON array with exactly ONE object:
{
 "summary_ko": [3 short Korean sentences summarizing the article],
 "key": [5 lemmas from "glossary" that matter most for understanding],
 "sentences": [one object per input sentence, same order: {"ko": "natural Korean translation"}],
 "glossary": [15 to 40 content words that appear in the text and are B1 or harder (skip A1/A2 basics, names, numbers): {"form": "exact word form as written in the text", "lemma": "dictionary form (nouns capitalized, verbs infinitive, separable verbs joined e.g. einleiten)", "pos": "noun|verb|adj|adv|other", "gender": "der|die|das|null", "gloss_ko": "short Korean meaning in this context", "level": "B1|B2|C1"}],
 "expressions": [6 useful multi-word expressions FROM the text, written in dictionary form with case slots like DW does ("etwas gelingt jemandem", "jemanden zu etwas verpflichten", "eine Sitzung abhalten", "auf etwas abzielen"). Prefer verb-centred collocations and fixed noun+verb phrases; never a bare preposition or filler like "gegenüber etwas" / "im Bereich etwas"; put the verb in the infinitive at the end: {"base": "...", "meaning_ko": "...", "s": sentence index where it occurs}],
 "quiz": [exactly 4 questions in this order:
   {"type": "topic", "q_ko": "기사는 무엇에 관한 것인가요?", "options": [4 Korean options], "answer": index},
   {"type": "detail", "q_ko": "a Korean question about a concrete fact in the text", "options": [4 Korean options], "answer": index},
   {"type": "article", "noun": "a noun from the glossary", "answer": "der|die|das", "s": sentence index},
   {"type": "cloze", "s": sentence index, "text": "that sentence with ONE expression word replaced by ___", "options": [4 German words], "answer": index}]
}
Rules: Korean must be natural (no translationese). Do not invent facts beyond the text. Output only the JSON array.`;
}

const s = (v) => (typeof v === 'string' ? v.trim() : '');
const POS = new Set(['noun', 'verb', 'adj', 'adv', 'other']);
const LV = new Set(['B1', 'B2', 'C1']);
const G = new Set(['der', 'die', 'das']);

/** AI 답(배열 또는 객체) → 검사한 lesson 또는 null. text = 본문 전체(낱말 꼴이 실제로 있는지 본다) */
export function acceptLesson(raw, { sentences }) {
  const o = Array.isArray(raw) ? raw[0] : raw;
  if (!o || typeof o !== 'object') return null;
  const text = sentences.join(' ');
  const n = sentences.length;
  const summary = (Array.isArray(o.summary_ko) ? o.summary_ko : []).map(s).filter(Boolean).slice(0, 3);
  const tr = Array.isArray(o.sentences) ? o.sentences.map((x) => s(x?.ko)) : [];
  if (summary.length < 2 || tr.length !== n || tr.some((x) => !x)) return null;
  const glossary = (Array.isArray(o.glossary) ? o.glossary : [])
    .map((x) => ({ form: s(x?.form), lemma: s(x?.lemma), pos: POS.has(x?.pos) ? x.pos : 'other', gender: G.has(x?.gender) ? x.gender : null, gloss_ko: s(x?.gloss_ko).slice(0, 40), level: LV.has(x?.level) ? x.level : 'B2' }))
    .filter((x) => x.form && x.lemma && x.gloss_ko && text.includes(x.form))
    .slice(0, 40);
  const lemmas = new Set(glossary.map((x) => x.lemma));
  const key = (Array.isArray(o.key) ? o.key : []).map(s).filter((x) => lemmas.has(x)).slice(0, 5);
  const expressions = (Array.isArray(o.expressions) ? o.expressions : [])
    .map((x) => ({ base: s(x?.base).slice(0, 120), meaning_ko: s(x?.meaning_ko).slice(0, 80), s: Number(x?.s) }))
    .filter((x) => x.base.includes(' ') && x.meaning_ko && Number.isInteger(x.s) && x.s >= 0 && x.s < n)
    .slice(0, 8);
  const quiz = acceptQuiz(o.quiz, { n, glossary });
  if (glossary.length < 5 || expressions.length < 3 || !quiz) return null;
  return { summary_ko: summary, key, sentences: sentences.map((de, i) => ({ de, ko: tr[i] })), glossary, expressions, quiz };
}

function acceptQuiz(q, { n, glossary }) {
  if (!Array.isArray(q) || q.length !== 4) return null;
  const out = [];
  for (const [i, type] of ['topic', 'detail', 'article', 'cloze'].entries()) {
    const x = q[i];
    if (x?.type !== type) return null;
    if (type === 'article') {
      const noun = s(x.noun);
      const g = glossary.find((w) => w.lemma === noun && w.pos === 'noun');
      const ans = g?.gender ?? (G.has(x.answer) ? x.answer : null);
      if (!noun || !ans || !Number.isInteger(Number(x.s))) return null;
      out.push({ type, noun, answer: ans, s: Math.min(n - 1, Math.max(0, Number(x.s))) });
      continue;
    }
    const options = (Array.isArray(x.options) ? x.options : []).map(s).filter(Boolean);
    const answer = Number(x.answer);
    if (options.length < 3 || options.length > 4 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
    if (type === 'cloze') {
      if (!s(x.text).includes('___') || !Number.isInteger(Number(x.s))) return null;
      out.push({ type, text: s(x.text), options, answer, s: Math.min(n - 1, Math.max(0, Number(x.s))) });
    } else {
      if (!s(x.q_ko)) return null;
      out.push({ type, q_ko: s(x.q_ko), options, answer });
    }
  }
  return out;
}
