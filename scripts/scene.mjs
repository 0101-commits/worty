// 그림 장면(scene_en) 규칙 한 곳 — 2026-11-02 v11 그림 품질 개선(G1·G2·G3·G5·G7).
// 장면을 쓰는 모든 프롬프트(lib.mjs RULES · daily.mjs writeText/writeScenes · judge.mjs 고친 장면)가 여기 규칙을 가져다 쓴다.
// 실측(355장 눈 검토): 또렷 67% · 약함 32% · 틀림 4. 원인 = 한 가지 규칙(「소품이나 동작으로 뜻을 연기」) → 직업 명사는 전부 연단·책상,
// 추상어는 클립보드·돋보기·상자·지도. 그래서 낱말 종류별 규칙 + 금지 소품 + 추상어는 두 칸 그림.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 장면 한 줄 최대 길이. 두 칸 장면은 길어서 예전 300 에서 올림(Worker 의 scene_en 상한도 같이 올림) */
export const SCENE_MAX = 420;

// ---------- G1 낱말 종류 ----------
export const WORD_CLASSES = ['concrete', 'person', 'action', 'state', 'abstract'];

/** 직업·역할 명사: 그 역할만 가진 물건 둘 + 장소(G1). 모르는 역할은 같은 방식으로 모델이 만든다 */
export const ROLE_HINTS = {
  Richter: "judge's black robe and a gavel, at a judge's bench",
  Richterin: "judge's black robe and a gavel, at a judge's bench",
  Bürgermeister: "mayor's chain of office (sash) and a town hall building behind",
  Bürgermeisterin: "mayor's chain of office (sash) and a town hall building behind",
  Minister: 'a small national-flag pin on the lapel and a briefcase, in front of a government building',
  Ministerin: 'a small national-flag pin on the lapel and a briefcase, in front of a government building',
  Zeuge: 'raising one paw while standing in a witness stand (a small raised box with a rail)',
  Zeugin: 'raising one paw while standing in a witness stand (a small raised box with a rail)',
  Angeklagter: "sitting alone in the defendant's seat with a uniformed guard standing next to it",
  Polizist: 'a police cap with badge and a police car with a blue light behind',
  Arzt: 'a white coat with a stethoscope around the neck and a patient bed beside',
  Ärztin: 'a white coat with a stethoscope around the neck and a patient bed beside',
  Lehrer: 'a pointer stick and a green blackboard with a drawn picture (no letters), pupils as small puppies',
  Lehrerin: 'a pointer stick and a green blackboard with a drawn picture (no letters), pupils as small puppies',
  Anwalt: 'a black lawyer gown with white collar tabs, next to a pair of scales of justice',
  Anwältin: 'a black lawyer gown with white collar tabs, next to a pair of scales of justice',
  Journalist: 'a press badge on a lanyard and a big microphone held toward another puppy',
  Soldat: 'a helmet and a camouflage uniform with a backpack, standing at attention',
  Bauer: 'a straw hat and a pitchfork in front of a barn with a cow',
  Koch: "a tall white chef's hat and a pot with a ladle, at a stove",
  Pilot: 'a pilot cap with wings badge in a cockpit with a round steering wheel and windows full of sky',
  Feuerwehrmann: 'a red fire helmet and a fire hose in front of a fire engine',
  Abgeordneter: 'sitting in a rising half-circle of parliament seats, raising a hand to vote',
  Abgeordnete: 'sitting in a rising half-circle of parliament seats, raising a hand to vote',
  Präsident: 'a sash in national colors and a flag on a pole next to a grand palace entrance',
  Kanzler: 'a dark suit with a national-flag lapel pin, in front of a chancellery building with a flag',
  Kanzlerin: 'a dark suit with a national-flag lapel pin, in front of a chancellery building with a flag',
  Botschafter: 'a flag of a foreign country on a pole next to an embassy gate, shaking paws with another puppy',
  Bischof: 'a tall pointed bishop hat (mitre) and a curved staff (crozier) in front of a church',
  Gärtner: 'a straw hat, a watering can and a spade, among flower beds',
  Verkäufer: 'standing behind a shop counter with a cash register, handing a bag to a customer',
  Verkäuferin: 'standing behind a shop counter with a cash register, handing a bag to a customer',
  Kellner: 'a bow tie and a tray with a drink balanced on one paw, between restaurant tables',
  Kellnerin: 'a bow tie and a tray with a drink balanced on one paw, between restaurant tables',
  Bäcker: 'a baker hat and a tray of bread loaves, next to a stone oven',
  Mechaniker: 'blue overalls and a big wrench, next to a car with an open hood',
  Friseur: 'a comb and scissors, cutting the fur of another puppy in a barber chair',
  Zahnarzt: 'a white coat, a mouth mirror and a big tooth model, next to a dentist chair',
  Architekt: 'a hard hat and a rolled drawing, in front of a model house',
  Schaffner: 'a conductor cap and a whistle, standing at a train door',
  Detektiv: 'a long trench coat with a flat cap, following paw prints on the ground',
};

const PERSON_SUFFIX = /(?:ist|ling|mann|frau|meister|sprecher|leiter|chef|führer|berater|händler|arbeiter|spieler|schüler|student|studentin|ärztin|erin|nerin)$/i;
const ABSTRACT_NOUN_SUFFIX = /(?:heit|keit|schaft|tum|ion|ität|ismus|anz|enz|ung|nis|ik|ie|ment|age|ur)$/i;

/**
 * 낱말 종류 힌트(G1): concrete · person · action · state · abstract.
 * 코드가 어림으로 정해 프롬프트에 「class_hint」로 주고, 모델이 아니다 싶으면 고치게 한다.
 */
export function classifyWord({ lemma = '', pos = '', gender = null } = {}) {
  if (pos === 'verb') return 'action';
  if (pos === 'adj') return 'state';
  if (pos === 'noun') {
    if (lemma in ROLE_HINTS) return 'person';
    // 「-in」 여성형(Kanzlerin): 사전에 남성형이 있거나 길이가 충분한 -in 명사
    if (/in$/.test(lemma) && lemma.length >= 6 && gender === 'die' && Object.keys(ROLE_HINTS).some((k) => lemma === `${k}in`)) return 'person';
    if (PERSON_SUFFIX.test(lemma) && lemma.length >= 6) return 'person';
    if (ABSTRACT_NOUN_SUFFIX.test(lemma) && lemma.length >= 7) return 'abstract';
    return 'concrete';
  }
  // 부사 · 접속사 · 불변화사 · 전치사 · 대명사 · 수사 · 숙어 · 기타
  return 'abstract';
}

// ---------- G1·G3 규칙 글 ----------
/** 그림에 쓰지 않는 소품·기호(G3). 장면 글에 이 낱말이 나오면 거절하고 다시 쓰게 한다 */
export const BANNED_PROPS = ['podium', 'lectern', 'clipboard', 'magnifying glass', 'magnifier', 'empty box', 'cardboard box', 'map', 'frame', 'border', 'checkmark', 'check mark', 'tick mark', 'question mark', 'exclamation mark', 'speech bubble', 'thought bubble', 'sign', 'banner', 'label', 'text', 'letters', 'number', 'x mark'];
const BANNED_RES = BANNED_PROPS.map((w) => new RegExp(`\\b${w.replace(/ /g, '\\s+')}s?\\b`, 'i'));
const BANNED_SYMBOLS = /[?!✓✗✔✘]|\bX\b|\bheart/;

/** 장면에서 금지 소품·기호를 찾아 이름 목록으로. 사랑·애정 낱말이면 하트는 허용(wordHint = 낱말 뜻 영어/한국어 한 줄). 두 칸 장면의 「panel」은 허용 */
export function bannedIn(scene, { allowHeart = false } = {}) {
  const s = String(scene ?? '');
  const hits = [];
  BANNED_PROPS.forEach((w, i) => {
    if (BANNED_RES[i].test(s)) hits.push(w);
  });
  if (/\bpanels?\b/i.test(s) && !isTwoPanel(s)) hits.push('panels');
  const sym = s.match(BANNED_SYMBOLS);
  if (sym && !(allowHeart && /heart/.test(sym[0]))) hits.push(sym[0].trim());
  return [...new Set(hits)];
}

const BAN_LINE =
  'NEVER use these: a podium or lectern, a desk with paper stacks, a clipboard, a magnifying glass, an empty box, a map, signs, banners, speech bubbles, ' +
  'the symbols ? ! ✓ ✗ X, hearts (only for words about love or affection), frames or borders, panels (except in the two-panel format below), letters or text of any kind.';

export const TWO_PANEL_RULE =
  'Two-panel format (ONLY for class "abstract"): write "Two panels: left — <situation>; right — <the same situation that differs in exactly ONE thing that shows the meaning>". ' +
  'Both panels keep the same setting, characters and layout; only that one thing changes (bereits = left: a friend just arrives, Borti\'s bowl is full, a wall clock shows 7:00; right: same clock, Borti\'s bowl is already empty). ' +
  'No symbols and no text; the difference must be a visible object, position or action. Max 60 words.';

/** 종류별 규칙(프롬프트에 그대로 들어감) */
export const CLASS_RULES = [
  '  · concrete noun → the thing itself, large and centered, in its most typical use or form (Kühlschrank: Borti opens a big fridge full of food).',
  '  · person/role noun → the TWO objects only that role has plus its typical place; Borti wears or uses them. Never a generic podium/desk. ' +
    "(Richter = judge's robe + gavel at a bench; Bürgermeister = mayor's chain + town hall; Zeuge = raising a paw in a witness stand.)",
  '  · action verb → the action at its most unmistakable moment, with the thing being acted on and its visible result (springen: Borti mid-air over a puddle).',
  '  · state adjective → exaggerate the quality and put its opposite beside it (eng: Borti squeezing through a very narrow gap next to a wide open door); no symbols.',
  '  · abstract (adverbs, conjunctions, particles, pronouns, and abstract nouns/verbs/adjectives that cannot be drawn as one object) → ' + TWO_PANEL_RULE,
].join('\n');

/** 낱말 종류 분류 지시 + 종류별 규칙 + 금지 목록. lib.mjs RULES · writeText 가 쓰는 짧은 판 */
export const SCENE_RULE_SHORT =
  'ONE English line (≤25 words; a two-panel scene up to 60 words) starting with "Borti " (or "Two panels:" for an abstract word) — first classify the word as concrete noun, person/role noun, action verb, state adjective or abstract, then follow that class: ' +
  'concrete = the object itself large; person/role = the two objects only that role has + its place (judge = robe + gavel at a bench); action = the most unmistakable moment of the action; ' +
  'state = the exaggerated quality beside its opposite; abstract = "Two panels: left — …; right — …" the same situation differing in exactly one thing that shows the meaning. ' +
  `${BAN_LINE} Only Borti unless a second character is needed ("another puppy"). Family-friendly even for crime or violence words (show it symbolically).`;

/** 장면 쓰기 전용 프롬프트(daily.mjs writeScenes · judge 고친 장면)에 넣는 규칙 덩어리 */
export function sceneRulesBlock() {
  return `Rules for each scene (ONE English line, max ${SCENE_MAX} characters; normal scenes max 28 words; start with "Borti", or with "Two panels:" for abstract words):
- FIRST classify the word: concrete noun | person/role noun | action verb | state adjective | abstract. "class_hint" is only a guess; correct it if wrong. When the word has several meanings, draw the first Korean meaning.
- Then follow the rules of that class:
${CLASS_RULES}
- Begin with the key: the ONE object or action that stands for the word, drawn large. At most 2 props and at most one other character (a puppy or kitten), only if the meaning needs them. Place = one short phrase at most.
- ${BAN_LINE}
- A small image model draws it and drops details, so keep it SIMPLE: one glance must say the word, and a viewer who is NOT told the word should be able to pick it out among five other words of the same kind.`;
}

/** 직업·역할 힌트 한 줄(해당 낱말만). 프롬프트의 항목에 role_hint 로 붙인다 */
export const roleHint = (lemma) => ROLE_HINTS[lemma] ?? null;

// ---------- G2 두 칸 장면 ----------
const TWO_RE = /^\s*(?:\[pin\]\s*)?Two\s+panels?\s*:\s*left\s*[—–-]\s*(.+?)\s*;\s*right\s*[—–-]\s*(.+?)\s*\.?\s*$/is;

/** 두 칸 장면이면 {left, right}, 아니면 null */
export function parseTwoPanel(scene) {
  const m = TWO_RE.exec(String(scene ?? ''));
  return m && m[1].length > 5 && m[2].length > 5 ? { left: m[1].trim(), right: m[2].trim() } : null;
}
export const isTwoPanel = (scene) => parseTwoPanel(scene) !== null;

// ---------- 고정(pin) — 사람이 쓴 장면을 매일 작업이 덮어쓰지 않게 ----------
// 장면 앞에 「[pin] 」을 붙이면 daily.mjs 가 그 단어의 장면은 다시 쓰지 않는다(redraw_v11.sql 처럼 손으로 쓴 장면용). 그림 프롬프트·판정에는 떼고 보낸다.
export const isPinned = (s) => /^\s*\[pin\]\s/.test(String(s ?? ''));
export const stripPin = (s) => String(s ?? '').replace(/^\s*\[pin\]\s+/, '');
/** 장면 글이 올바른 꼴인가(Borti 로 시작하거나 두 칸) */
export const sceneShapeOk = (s) => {
  const t = stripPin(s).trim();
  return /^Borti\b/.test(t) || isTwoPanel(t) || /\bBorti\b/.test(t);
};

// ---------- G5(a) 겹치는 장면 ----------
const STOP = new Set(
  ('a an the and or of to in on at with his her its their him them is are be being by for from into onto over under up down near next beside behind front ' +
    'borti puppy white chubby little small big large huge giant tiny very while as that this it one two another other same left right panel panels scene ' +
    'standing sitting holding looking front view all four paws visible still stands sits looks holds ' +
    'shows showing wearing')
    .split(' '),
);
/** 장면의 내용어 집합(소문자 · 어미 s 떼기 · 불용어 제외) */
export function contentWords(scene) {
  const words = stripPin(scene).toLowerCase().match(/[a-z]+/g) ?? [];
  return new Set(words.map((w) => (w.length > 4 ? w.replace(/(?:ing|es|s)$/, '') : w)).filter((w) => w.length > 2 && !STOP.has(w)));
}
/** a 의 내용어 중 b 에도 있는 비율(0~1) */
export function sceneOverlap(a, b) {
  const A = contentWords(a);
  if (A.size < 3) return 0; // 너무 짧으면 비교 안 함
  const B = contentWords(b);
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / A.size;
}
/** 다른 단어의 장면 중 내용어 60% 이상 겹치는 것 → {id, overlap, scene} | null. existing = {id: scene} */
export function findDuplicateScene(id, scene, existing, limit = 0.6) {
  let best = null;
  for (const [oid, os] of Object.entries(existing ?? {})) {
    if (oid === id || !os) continue;
    const o = sceneOverlap(scene, os);
    if (o >= limit && (!best || o > best.overlap)) best = { id: oid, overlap: +o.toFixed(2), scene: os };
  }
  return best;
}

// ---------- 상태 파일(.data/, daily.yml 이 main 에 되올린다) ----------
export const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.data');
export const SCENES_FILE = path.join(DATA_DIR, 'scenes.json'); // {단어 id: 장면} — 겹침 검사용 색인(DB 전체 읽기 없이)
export const FEEDBACK_FILE = path.join(DATA_DIR, 'image-feedback.json'); // [{id, lemma, pos, scene, ok, at}] — 사람 결정(G7)

export function readJsonFile(file, fallback) {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}
export function writeJsonFile(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
}

// ---------- G7 사람 결정 → few-shot ----------
/** 결정 기록에 더하기(같은 단어는 최신 하나만). ok = 남김(좋은 예) · false = 다시 그리기(나쁜 예) */
export function addFeedback(list, entry) {
  const out = (Array.isArray(list) ? list : []).filter((x) => x.id !== entry.id);
  out.push({ id: entry.id, lemma: entry.lemma ?? '', pos: entry.pos ?? '', scene: stripPin(entry.scene ?? '').slice(0, SCENE_MAX), ok: entry.ok === true, at: entry.at ?? new Date().toISOString() });
  return out.slice(-200);
}

/**
 * 프롬프트에 넣을 좋은·나쁜 예(각 최대 per 개, 최신 먼저, 이번 묶음과 같은 종류를 앞세움). 기록이 없으면 빈 문자열.
 * classes = 이번 묶음 낱말 종류 집합
 */
export function fewShotBlock(feedback, classes = [], per = 2) {
  const list = (Array.isArray(feedback) ? feedback : []).filter((x) => x.scene);
  const rank = (x) => (classes.includes(classifyWord({ lemma: x.lemma, pos: x.pos })) ? 0 : 1);
  const pick = (ok) =>
    list
      .filter((x) => x.ok === ok)
      .map((x, i) => ({ x, i }))
      .sort((a, b) => rank(a.x) - rank(b.x) || b.i - a.i)
      .slice(0, per)
      .map(({ x }) => `  · ${x.lemma ? x.lemma + ': ' : ''}${x.scene}`);
  const good = pick(true);
  const bad = pick(false);
  if (!good.length && !bad.length) return '';
  return `The owner reviewed real pictures. Scenes whose picture was KEPT (good — imitate their clarity):\n${good.join('\n') || '  (none yet)'}\nScenes whose picture was REJECTED for redrawing (bad — do not repeat their approach):\n${bad.join('\n') || '  (none yet)'}\n`;
}
