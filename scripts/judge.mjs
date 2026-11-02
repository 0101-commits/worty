// 그림 뜻 검사(2026-10-14 사용자 「그림이 단어 뜻과 안 이어진다」). 매일 작업(daily.mjs)이 올리기 전에 부른다.
// 2026-11-02 v11(G4): 단어·뜻을 먼저 보여 주고 「이어지나」 묻던 방식은 답이 새서 너그러웠다(추상어는 기호만 있어도 통과, 눈 검토 355장 중 32% 약함).
// 그래서 kaggle/draw.py 와 같은 3단계로 바꿨다 —
//   ① 단어를 모른 채 그림만 묘사  ② 눈가림 객관식(정답 + 같은 품사·비슷한 등급의 다른 단어 5개, 순서를 바꾼 두 목록 모두 맞혀야)  ③ 몸·틀·글자·기호 검사
//   최종 ok = ②를 모두 맞히고 ③의 칸이 모두 true. 모델이 적은 ok 는 무시한다(draw.py 와 같은 이유: 칸이 다 true 인데 ok=false 로 적은 경우가 있었다).
// ①②는 한 요청(묘사 → 고르기 순서로 답하게 함), ③은 ②를 통과한 그림만 두 번째 요청 → 그림당 요청이 예전의 약 2배(통과분만 ③).
// 청크·한도는 그대로(Groq 3장 · OpenRouter 3장 · Gemini 한 번에) — 장부(ledger.mjs)의 하루 몫은 요청마다 확인한다.
// 탈락이면 고친 장면(scene)도 받아 한 번 다시 그린다: ③ 에서 몸이 틀렸으면 그 요청의 scene, 눈가림 탈락이면 글 AI 에 새 장면을 부탁한다(fixScenes).
// AI 가 실패하면 null(판정 못 함). 예전엔 빈 Map = 통과였는데 그러면 몸 구조 오류가 검사 없이 올라간다 → 부르는 쪽이 올리지 않고 「검사 대기」로 맡긴다(daily.mjs).
// 모델 차례: Groq(qwen3-vl) → Gemini Flash → OpenRouter. 판정 일부만 와도 온 것만 쓴다(빠진 것은 대기에 남음). 그림은 긴 변 512 로 줄여 보낸다.
// 손 검사: node scripts/judge.mjs items.json   (items = [{id, word, meaning_ko, file, pos?, level?, scene?}] → 줄마다 판정)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { VISION_MODELS, askJson, askGroqJson, askOpenRouterJson } from './ai.mjs';
import { judgeAllowed, recordJudgeUsage } from './ledger.mjs';
import { SCENE_MAX, bannedIn, classifyWord, isTwoPanel, sceneRulesBlock, sceneShapeOk, stripPin } from './scene.mjs';

// Groq 는 한 번에 이미지 3장까지(Groq 공식 문서)
const GROQ_CHUNK = 3;
// OpenRouter 는 하루 요청 수가 한도라 한 번에 3장씩(OPENROUTER_CHUNK 로 바꿈)
const OR_CHUNK = Number(process.env.OPENROUTER_CHUNK) || 3;

// ---------- 눈가림 보기 ----------
// 보기 낱말 후보: daily.mjs 가 올라간 그림 단어 목록(/api/admin/images)으로 채운다 [{id, word, meaning_ko, pos?, level?}]
let POOL = [];
export function setDistractorPool(list) {
  POOL = Array.isArray(list) ? list.filter((w) => w?.word && w?.meaning_ko) : [];
}
// 후보가 모자랄 때 쓰는 흔한 낱말(kaggle.mjs 와 같은 것)
const FILLER = [['das Haus', '집'], ['essen', '먹다'], ['schnell', '빠른'], ['der Baum', '나무'], ['schlafen', '자다'], ['rot', '빨간']];
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** 정답 낱말과 같은 품사·비슷한 등급의 다른 낱말 n 개. 순서는 id 로 고정(같은 그림은 늘 같은 보기). it.distractors 가 있으면 그대로 */
export function pickDistractors(it, pool = POOL, n = 5) {
  if (Array.isArray(it.distractors) && it.distractors.length >= n) return it.distractors.slice(0, n);
  const lv = (x) => String(x ?? '').toUpperCase();
  const cand = pool
    .filter((w) => w.id !== it.id && w.word !== it.word && w.meaning_ko !== it.meaning_ko)
    .map((w) => ({ w, miss: (it.pos && w.pos && w.pos !== it.pos ? 2 : 0) + (it.level && w.level && lv(w.level) !== lv(it.level) ? 1 : 0), h: hash(`${it.id}|${w.word}`) }))
    .sort((a, b) => a.miss - b.miss || a.h - b.h);
  const out = cand.slice(0, n).map(({ w }) => ({ word: w.word, meaning_ko: w.meaning_ko }));
  for (const [word, meaning_ko] of FILLER) if (out.length < n && word !== it.word) out.push({ word, meaning_ko });
  return out;
}

const LETTERS = 'ABCDEF';
/** 그림 하나의 보기 두 벌(순서만 다름) + 정답 글자. 결정적 */
export function buildOptions(it) {
  const opts = [{ word: it.word, meaning_ko: it.meaning_ko }, ...pickDistractors(it)].slice(0, 6);
  const shuffled = (seed) => opts.map((o) => ({ o, h: hash(`${it.id}${seed}${o.word}`) })).sort((a, b) => a.h - b.h).map(({ o }) => o);
  const a = shuffled('a');
  let b = shuffled('b');
  if (b.every((o, i) => o === a[i])) b = [...b.slice(1), b[0]]; // 우연히 같은 순서면 한 칸 돌림
  const letter = (list) => LETTERS[list.findIndex((o) => o.word === it.word)];
  return { a, b, correctA: letter(a), correctB: letter(b) };
}
const listText = (list) => list.map((o, i) => `${LETTERS[i]}. ${o.word} — ${o.meaning_ko}`).join('\n');

// ---------- ① ② 눈가림 요청 ----------
export function blindPrompt(items) {
  const lists = items.map((it, i) => {
    const o = it._opts;
    return `#${i + 1} list A:\n${listText(o.a)}\n#${i + 1} list B:\n${listText(o.b)}`;
  });
  return `You see ${items.length} doodle pictures made for German vocabulary flashcards. Each picture was drawn to illustrate exactly ONE German word, like a picture dictionary, but you are NOT told which word. Each attached picture follows its label #n.
For EACH picture #n do three things in this order:
1. "desc": 1-3 short factual sentences about what is visibly drawn (every object, every character with pose and expression, symbols). Do NOT guess any word here.
2. "pick_a": which word of "#n list A" the picture illustrates. ONE letter.
3. "pick_b": the same question for "#n list B" (same words, other order). ONE letter.
If the picture is generic (for example the puppy just stands, sits, smiles or wears something) and none of the options is clearly shown, answer X.
${lists.join('\n')}
Output ONLY a JSON array with exactly ${items.length} items: [{"n":1,"desc":"…","pick_a":"C","pick_b":"E"}]`;
}

const letterOf = (v) => String(v ?? '').trim().slice(0, 1).toUpperCase();

/** 눈가림 답 → Map(n → {desc, a, b, pass}) . 번호가 없거나 pick 이 빠지면 그 그림은 빠진 것(판정 못 받음) */
export function parseBlind(arr, items) {
  const m = new Map();
  for (const o of Array.isArray(arr) ? arr : []) {
    const n = Number(o?.n);
    const it = items[n - 1];
    if (!it || !it._opts || !letterOf(o.pick_a) || !letterOf(o.pick_b)) continue;
    const a = letterOf(o.pick_a);
    const b = letterOf(o.pick_b);
    m.set(n, { desc: String(o.desc ?? '').slice(0, 400), a, b, pass: a === it._opts.correctA && b === it._opts.correctB });
  }
  return m;
}
const pickedWord = (it, letter, which) => (letter === 'X' ? '어느 것도 아님' : it._opts[which][LETTERS.indexOf(letter)]?.word ?? letter);

// ---------- ③ 몸·틀·글자·기호 요청 ----------
export function stylePrompt(items, descs) {
  const cards = items.map((it, i) => `#${i + 1}: ${descs[i] ? `neutral description: "${descs[i].slice(0, 300)}"` : ''}${it.twoPanel === true ? ' (a TWO-PANEL picture is expected: exactly two side-by-side panels with one thin divider in the middle)' : it.twoPanel === false ? ' (a single picture is expected)' : ''}`);
  return `You check doodle pictures for a German vocabulary app. You do NOT judge the meaning, only the drawing rules. Each attached picture follows its label #n.
${cards.join('\n')}
Check EACH animal's BODY first (the puppy is the mascot Borti; another puppy or kitten may appear): count legs/paws, ears, eyes, tails and heads one by one before deciding.
- legs_ok: false if any animal has more or fewer than four legs/paws, or Borti shows fewer than all four (two front paws and two hind paws; only a separate object or a curled-up sleeping pose may cover a leg). Extra legs are never fine.
- body_ok: false if an animal has an extra or missing head, ear, eye or tail, a limb growing from the wrong place, floating or detached parts, bodies merged with each other or with an object, or Borti drawn twice.
- frame_ok: false if the picture has a frame, border or box line around it, or comic panels. EXCEPT one thin vertical divider in the middle of a two-panel picture, which is allowed.
- text_ok: false if any letters, words, numbers or labels are drawn.
- symbol_ok: false if the picture relies on symbols such as ? ! check marks, X marks or hearts (a heart is fine only if the picture is clearly about love or affection).
- panels: how many side-by-side panels the picture has (1 or 2).
When the body is wrong, "why" names it (e.g. "다리가 3개", "다리가 5개"). For a wrong body also write "scene": ONE better English line, max 30 words, starting with "Borti": same idea, simpler pose with fewer overlapping limbs (Borti sitting or standing still, front view, all four paws visible, at most one paw raised), no symbols, no letters.
Output ONLY a JSON array with exactly ${items.length} items, "why" FIRST (short Korean), then the flags: [{"n":1,"why":"…","legs_ok":true,"body_ok":true,"frame_ok":true,"text_ok":true,"symbol_ok":true,"panels":1}] — ok is decided by the code, do not write it.`;
}

const STYLE_FLAGS = [['legs_ok', '다리 수'], ['body_ok', '몸 구조'], ['frame_ok', '틀·테두리'], ['text_ok', '글자'], ['symbol_ok', '기호만으로 표현']];

/** 칸 검사 결과 → {ok, why, scene}. 모델의 ok 는 보지 않는다 */
export function styleVerdict(o, it) {
  const bad = STYLE_FLAGS.filter(([k]) => o[k] === false).map(([, label]) => label);
  const panels = Number(o.panels);
  if (it.twoPanel === true && panels && panels !== 2) bad.push('두 칸 아님');
  if (it.twoPanel === false && panels >= 2 && !bad.includes('틀·테두리')) bad.push('칸 나뉨');
  const scene = typeof o.scene === 'string' && /\bBorti\b/.test(o.scene) && !bannedIn(o.scene).length ? stripPin(o.scene).trim().slice(0, SCENE_MAX) : null;
  const why = bad.length ? `${bad.join('·')} 문제${o.why ? ` — ${String(o.why).slice(0, 60)}` : ''}` : String(o.why ?? '통과').slice(0, 120);
  return { ok: bad.length === 0, why: why.slice(0, 120), scene: bad.length ? scene : null };
}

// 검사 AI 에 보내는 그림 크기(긴 변). 작을수록 토큰이 준다(Groq 하루 토큰 한도) — JUDGE_MAX_SIDE 로 바꿈, 기본 512
const MAX_SIDE = Number(process.env.JUDGE_MAX_SIDE) || 512;

async function prepImages(items) {
  const images = [];
  for (const [i, it] of items.entries()) images.push({ label: `#${i + 1}`, png: await sharp(it.png).resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', background: '#fff' }).flatten({ background: '#fff' }).png().toBuffer() });
  return images;
}

// ---------- 옛 한 단계 프롬프트(kaggle.mjs · judge-compare.mjs 가 아직 쓴다 — 단어를 보여 주는 판이라 매일 작업은 쓰지 않는다) ----------
export function buildPrompt(cards) {
  return `You check doodle pictures for German vocabulary flashcards (learner: Korean speaker). Each picture must illustrate the WORD ITSELF (its core meaning, like a picture dictionary), not a sentence or story. Each attached picture follows its label #n.
Cards: ${JSON.stringify(cards)}
For EACH n decide "ok". ok=true only if a learner who sees the picture next to the word and its Korean meaning immediately connects them:
- the thing or action that stands for the WORD is actually drawn, large and clear (not missing, not tiny, not replaced by something else);
- abstract words (adverbs, particles, conjunctions…) pass only when drawn objects or a two-panel contrast show the concept — never when only symbols (? ! check marks X hearts) carry it;
- the picture is not a specific story that needs a sentence to explain it;
- nothing in the picture contradicts the meaning.
Be strict: if the learner would have to guess why this picture fits the word, ok=false.
ALSO check every animal's BODY (the puppy is the mascot Borti; another puppy or kitten may appear). Before deciding, count each animal's legs/paws, ears, eyes, tails and heads one by one. ok=false if any animal has: more than four legs or paws, an extra or missing head, ear, eye or tail, a limb growing from the wrong place, floating or detached body parts, bodies merged with each other or with an object, or Borti drawn twice. Borti must show all four legs (two front paws and two hind paws): ok=false when one is missing, even if it could be "hidden behind his own body" — only a separate object (box, blanket, desk, door, another character) may cover a leg, or a curled-up sleeping pose. Extra legs are never fine. When the body is wrong, "why" names it (e.g. "다리가 3개", "다리가 5개").
Also ok=false when the picture has a frame or border, or drawn letters or numbers. Line style and colors are not your concern.
For ok=false also write "scene": a better ONE-line English scene, max 30 words, starting with "Borti": the key object or action first and large, at most 2 props, at most one other character (a puppy or kitten), no symbols, no letters or numbers. If the body was wrong, keep the idea but use a simpler pose with fewer overlapping limbs (Borti sitting or standing still, front view, all four paws visible, at most one paw raised).
Output ONLY a JSON array with exactly ${cards.length} items: [{"n":1,"ok":true,"why":"짧은 한국어 이유"}, {"n":2,"ok":false,"why":"…","scene":"Borti …"}]`;
}

// 장부(ledger.mjs) 연결 — daily.mjs 가 켠다. 켜면 검사 AI 사용량을 적고, 손 실행은 예약 실행 몫을 건드리기 전에 멈춘다. 안 켜면(손 검사 CLI · 시험) 그대로 부른다
let usage = null;
/** ctx = {ledger, cfg, day: () => 'YYYY-MM-DD'(UTC), save?: () => void} · null 이면 끔 */
export function setJudgeLedger(ctx) {
  usage = ctx;
}
const allowed = (p) => !usage || judgeAllowed(usage.ledger, usage.day(), p, usage.cfg);
const noteUsage = (p) => ({ tokens }) => {
  if (!usage) return;
  recordJudgeUsage(usage.ledger, usage.day(), p, tokens);
  usage.save?.();
};

/**
 * 그림 묶음 하나를 3단계로 판정해 out 에 채운다 → 채운 장수.
 * ask(prompt, images) = 이 AI 로 한 번 묻기 · gate() = 요청 전에 하루 몫 확인(막히면 던짐)
 */
export async function judgeChunk(ask, gate, chunk, out) {
  for (const it of chunk) it._opts = buildOptions(it);
  gate();
  const blind = parseBlind(await ask(blindPrompt(chunk), await prepImages(chunk)), chunk);
  let n = 0;
  const survivors = [];
  for (const [i, it] of chunk.entries()) {
    const b = blind.get(i + 1);
    if (!b) continue; // 판정 못 받음 → 대기에 남음
    if (b.pass) survivors.push({ it, desc: b.desc });
    else {
      const picked = [...new Set([pickedWord(it, b.a, 'a'), pickedWord(it, b.b, 'b')])].join('/');
      out.set(it.id, { ok: false, why: `눈가림 객관식 탈락(고른 것: ${picked})`.slice(0, 120), scene: null, stage: 'blind', desc: b.desc });
      n++;
    }
  }
  if (survivors.length) {
    gate();
    const items = survivors.map((s) => s.it);
    const arr = await ask(stylePrompt(items, survivors.map((s) => s.desc)), await prepImages(items));
    for (const o of Array.isArray(arr) ? arr : []) {
      const s = survivors[Number(o?.n) - 1];
      if (!s) continue;
      out.set(s.it.id, { ...styleVerdict(o, s.it), stage: 'style', desc: s.desc });
      n++;
    }
  }
  return n;
}

// 검사 AI 하나. todo = 아직 판정 못 받은 그림 → 받은 만큼 out 에 채운다. 막히면 던지거나 0장
const PROVIDERS = {
  async groq(todo, out) {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY 없음');
    let ok = 0;
    const ask = (p, images) => askGroqJson(p, { images, onUsage: noteUsage('groq') });
    for (let s = 0; s < todo.length; s += GROQ_CHUNK) {
      const chunk = todo.slice(s, s + GROQ_CHUNK);
      try {
        ok += await judgeChunk(ask, () => {
          if (!allowed('groq')) throw Object.assign(new Error('Groq 하루 몫 예약분'), { quota: true });
        }, chunk, out);
      } catch (e) {
        if (e.quota) console.error('Groq 하루 몫 예약분 — 손 실행은 여기서 멈춤(나머지는 다음에)');
        else console.error(`Groq 청크 실패(나머지는 다음에): ${String(e.message || e).slice(0, 150)}`);
        break;
      }
    }
    return ok;
  },
  async gemini(todo, out) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY 없음');
    if (!allowed('gemini')) throw new Error('Gemini 하루 몫 예약분 — 손 실행은 부르지 않음');
    const ask = (p, images) => askJson(p, { images, models: VISION_MODELS, onUsage: noteUsage('gemini') });
    return judgeChunk(ask, () => {
      if (!allowed('gemini')) throw new Error('Gemini 하루 몫 예약분 — 두 번째 요청 못 함');
    }, todo, out);
  },
  async openrouter(todo, out) {
    if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY 없음');
    let ok = 0;
    const ask = (p, images) => askOpenRouterJson(p, { images, onUsage: noteUsage('openrouter') });
    for (let s = 0; s < todo.length; s += OR_CHUNK) {
      const chunk = todo.slice(s, s + OR_CHUNK);
      try {
        ok += await judgeChunk(ask, () => {
          if (!allowed('openrouter')) throw Object.assign(new Error('OpenRouter 하루 몫 한도·예약분'), { quota: true });
        }, chunk, out);
      } catch (e) {
        if (e.quota) console.error('OpenRouter 하루 몫 한도·예약분 — 여기서 멈춤(나머지는 다음에)');
        else console.error(`OpenRouter 청크 실패(나머지는 다음에): ${String(e.message || e).slice(0, 150)}`);
        break;
      }
    }
    return ok;
  },
};

/** 부르는 차례(JUDGE_ORDER 환경값, 쉼표 구분). 기본 groq → gemini → openrouter */
const order = () => String(process.env.JUDGE_ORDER || 'groq,gemini,openrouter').split(',').map((s) => s.trim()).filter((p) => PROVIDERS[p]);

// ---------- 눈가림 탈락 그림의 새 장면(글 AI, 그림 없음) ----------
/** 눈가림에서 떨어진 그림은 ③이 장면을 안 준다 → 글 AI 한 번(요청 하나)으로 새 장면을 받아 채운다. 실패하면 scene=null 그대로 */
export async function fixScenes(items, out) {
  const need = items.filter((it) => out.get(it.id)?.ok === false && !out.get(it.id).scene && out.get(it.id).stage === 'blind');
  if (!need.length || !process.env.GEMINI_API_KEY) return;
  const list = need.map((it) => {
    const v = out.get(it.id);
    return { id: it.id, word: it.word, pos: it.pos ?? null, meaning_ko: it.meaning_ko, class_hint: classifyWord({ lemma: String(it.word).replace(/^(der|die|das)\s+/, ''), pos: it.pos }), old_scene: stripPin(it.scene ?? ''), what_a_blind_viewer_saw: v.desc };
  });
  const prompt = `You rewrite image scenes for German vocabulary flashcards. A viewer who was NOT told the word looked at the doodle drawn from "old_scene" and could not pick the word among five words of the same kind (what they saw is in "what_a_blind_viewer_saw"). Write a NEW scene that makes the word unmistakable and clearly different from the old one.
${sceneRulesBlock()}
Output ONLY a JSON array [{"id": "...", "scene_en": "..."}] with exactly ${list.length} items. No prose, no code fence.
Items: ${JSON.stringify(list)}`;
  try {
    const arr = await askJson(prompt);
    for (const o of Array.isArray(arr) ? arr : []) {
      const it = need.find((x) => x.id === o?.id);
      if (!it || typeof o.scene_en !== 'string') continue;
      const sc = o.scene_en.trim().slice(0, SCENE_MAX);
      if (sceneShapeOk(sc) && !bannedIn(sc).length) out.get(it.id).scene = sc;
    }
  } catch (e) {
    console.error(`고친 장면 받기 실패(장면 없이 탈락 처리): ${String(e.message || e).slice(0, 150)}`);
  }
}

// 비교 스크립트(judge-compare.mjs)·kaggle.mjs 가 같은 프롬프트·길을 쓴다
export { PROVIDERS, prepImages };

/** items: [{id, word, meaning_ko, png, pos?, level?, scene?}] → Map(id → {ok, why, scene, stage, desc}) · AI 실패면 null. png 는 PNG·JPEG·WebP 버퍼 무엇이든
 *  2026-10-30 Groq 먼저(Gemini Flash 는 하루 ≈20번에 503 도 잦다) → 판정을 못 받은 그림만 다음 AI 로. 오류 없이 빈 답이 와도(0장 적용) 실패로 보고 넘어간다.
 *  items 에 scene 이 있으면 두 칸 장면 여부(twoPanel)를 판정에 쓴다 */
export async function judgeImages(items) {
  const out = new Map();
  if (!items.length) return out;
  const work = items.map((it) => ({ ...it, twoPanel: it.twoPanel ?? (it.scene ? isTwoPanel(it.scene) : undefined) }));
  for (const p of order()) {
    const todo = work.filter((it) => !out.has(it.id));
    if (!todo.length) break;
    try {
      const n = await PROVIDERS[p](todo, out);
      if (n === 0) throw new Error('쓸 수 있는 판정을 하나도 안 줌');
      console.log(`그림 검사 ${p} ${n}/${todo.length}장`);
    } catch (e) {
      console.error(`그림 검사 실패(${p}): ${String(e.message || e).slice(0, 200)}`);
    }
  }
  if (out.size) await fixScenes(work, out);
  return out.size ? out : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await import('./admin.mjs'); // .env 를 읽는다(GEMINI_API_KEY)
  const items = JSON.parse(readFileSync(process.argv[2], 'utf8')).map((it) => ({ ...it, png: readFileSync(it.file) }));
  const res = await judgeImages(items);
  for (const it of items) console.log(JSON.stringify({ id: it.id, word: it.word, ...(res?.get(it.id) ?? { ok: null }) }));
}
