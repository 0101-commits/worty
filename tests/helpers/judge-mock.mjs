// 눈가림 3단계 검사(scripts/judge.mjs)용 모의 AI 답 — 프롬프트를 읽어 단계별로 답한다. 네트워크 없이.
// 단계 ①② = 프롬프트에 「pick_a」 · ③ = 「legs_ok」 · 고친 장면 = 「You rewrite image scenes」

const FILLER = ['das Haus', 'essen', 'schnell', 'der Baum', 'schlafen', 'rot']; // judge.mjs 의 보기 채움 낱말 — 이게 아니면 정답

/** 프롬프트에서 #k 번 그림의 목록(A 또는 B) 줄 → [{letter, word}] */
export function optionsOf(prompt, k, list = 'A') {
  const m = prompt.match(new RegExp(`#${k} list ${list}:\\n([\\s\\S]*?)(?=\\n#\\d+ list |\\nOutput ONLY)`));
  return (m?.[1] ?? '')
    .split('\n')
    .map((l) => l.match(/^([A-F])\. (.+?) — /))
    .filter(Boolean)
    .map((x) => ({ letter: x[1], word: x[2] }));
}

/**
 * opts.wrong = 눈가림에서 일부러 틀리게 답할 그림 번호들 · opts.style = 칸 덮어쓰기(예: {legs_ok:false}) · opts.only = 앞에서 이만큼만 답함
 * opts.targets = 정답 낱말 집합 — 보기 중 이 집합에 드는 것이 정답(없으면 보기 첫 줄)
 */
export function answer(prompt, opts = {}) {
  const { wrong = [], style = {}, only = Infinity, targets = null } = opts;
  if (prompt.includes('You rewrite image scenes')) {
    return JSON.stringify([...prompt.matchAll(/"id":"(w\d+)"/g)].map((m) => ({ id: m[1], scene_en: 'Borti hugs one huge round balloon while a kitten watches' })));
  }
  const n = Number(prompt.match(/exactly (\d+) items/)?.[1] ?? 1);
  if (prompt.includes('pick_a')) {
    return JSON.stringify(
      Array.from({ length: Math.min(n, only) }, (_, i) => {
        const pick = (list) => {
          const o = optionsOf(prompt, i + 1, list);
          const right = o.find((x) => (targets ? targets.has(x.word) : !FILLER.includes(x.word))) ?? o[0];
          const bad = o.find((x) => x !== right) ?? o[0];
          return (wrong.includes(i + 1) ? bad : right)?.letter ?? 'A';
        };
        return { n: i + 1, desc: 'a white puppy next to an object', pick_a: pick('A'), pick_b: pick('B') };
      }),
    );
  }
  return JSON.stringify(Array.from({ length: n }, (_, i) => ({ n: i + 1, why: '좋음', legs_ok: true, body_ok: true, frame_ok: true, text_ok: true, symbol_ok: true, panels: 1, ...style })));
}

/** 요청 본문(Groq · OpenRouter = messages, Gemini = contents)에서 글 프롬프트와 그림 수 */
export function readBody(body) {
  const parts = body.messages ? body.messages[0].content : body.contents[0].parts;
  const arr = Array.isArray(parts) ? parts : [{ text: parts }];
  const text = arr.filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n');
  const images = arr.filter((p) => p.image_url || p.inline_data);
  return { text, images };
}
