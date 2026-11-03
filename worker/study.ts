// 「오늘 공부에 넣기」와 기사 낱말 바로 넣기(2026-11-03 개편).
//   POST /api/word/:id/today        — 새 단어 = 오늘 새 단어 목록 맨 앞(더 받은 수 +1) · 배운 단어 = 오늘 복습으로(마감을 지금으로)
//   POST /api/articles/:id/add-word — 기사 공부 자료의 낱말(뜻·품사·관사·레벨)과 그 문장을 예문으로 단어장에 바로 넣고 오늘 공부로
//   GET  /api/lookup?form=…         — 본문 낱말(활용형)로 단어장 찾기(어미 떼기 · 과거분사 되돌리기, 정확히 같은 기본형만)
// SQL 은 D1·Postgres 공용 꼴. 시험: tests/study.test.mjs
import type { AddFromArticleResponse, LookupResponse, StudyTodayResponse } from '../shared/api.ts';
import { ensurePlan, loadSettings } from './deck.ts';
import type { Env } from './env.ts';
import { HttpError, bad } from './http.ts';
import { clearMemo } from './memo.ts';
import { addDays, studyDay, studyDayStartUtc } from './time.ts';
import { insertWords } from './words.ts';
import { parseLesson } from './articles.ts';

interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  params: string[];
}

/** 카드 하나를 오늘 공부에 넣는다. 쉬게 한 카드는 다시 깨운다 */
export async function studyToday(db: D1Database, wordId: string, now: Date = new Date()): Promise<StudyTodayResponse> {
  const card = await db.prepare('SELECT state, due, suspended FROM cards WHERE word_id = ?').bind(wordId).first<{ state: number; due: string; suspended: number }>();
  if (!card) throw new HttpError(404, 'not_found');
  const woke = Number(card.suspended) === 1;
  if (woke) {
    await db.prepare('UPDATE cards SET suspended = 0, suspended_at = NULL WHERE word_id = ?').bind(wordId).run();
    clearMemo(db);
  }
  const date = studyDay(now);
  if (Number(card.state) === 0) {
    const settings = await loadSettings(db);
    for (let attempt = 0; attempt < 3; attempt++) {
      const plan = await ensurePlan(db, settings, date);
      if (plan.fresh.includes(wordId)) return { ok: true, mode: woke ? 'new' : 'already' };
      // 맨 앞에: 밀린 복습이 많아 새 단어 자리가 줄어도(freshAllowance) 이 단어는 남게
      const r = await db
        .prepare('UPDATE day_plans SET fresh = ?, extra = extra + 1 WHERE day = ? AND extra = ? AND fresh = ?')
        .bind(JSON.stringify([wordId, ...plan.fresh]), date, plan.extra, JSON.stringify(plan.fresh))
        .run();
      if (r.meta.changes) {
        clearMemo(db);
        return { ok: true, mode: 'new' };
      }
    }
    throw new HttpError(409, 'busy');
  }
  // 배운 단어: 오늘 학습일이 끝나기 전에 마감이면 이미 오늘 몫에 있다
  const dayEnd = studyDayStartUtc(addDays(date, 1));
  if (card.due < dayEnd) return { ok: true, mode: woke ? 'review' : 'already' };
  await db.prepare('UPDATE cards SET due = ? WHERE word_id = ?').bind(now.toISOString(), wordId).run();
  clearMemo(db);
  return { ok: true, mode: 'review' };
}

const postStudyToday = async ({ env, params: [id] }: Ctx) => Response.json(await studyToday(env.DB, id));

type Gloss = { form: string; lemma: string; pos: string; gender: string | null; gloss_ko: string; level: string };
type Lesson = { sentences?: Array<{ de: string; ko: string }>; glossary?: Gloss[] };
const POS_OK = new Set(['noun', 'verb', 'adj', 'adv', 'other']);

/** 기사 낱말 → 단어장(이미 있으면 그 카드) → 오늘 공부. 낱말 자료는 서버에 적힌 공부 자료에서만 읽는다(앱이 보낸 뜻을 믿지 않음) */
export async function addFromArticle(db: D1Database, articleId: number, lemma: unknown, now: Date = new Date()): Promise<AddFromArticleResponse> {
  if (typeof lemma !== 'string' || !lemma.trim() || lemma.length > 80) throw bad('bad_lemma');
  const row = await db.prepare('SELECT url, lesson FROM articles WHERE id = ?').bind(articleId).first<{ url: string; lesson: string | null }>();
  if (!row) throw new HttpError(404, 'not_found');
  const l = parseLesson(row.lesson) as Lesson | null;
  const g = l?.glossary?.find((x) => x.lemma === lemma);
  if (!g) throw bad('not_in_lesson');
  const pos = POS_OK.has(g.pos) ? g.pos : 'other';
  let have = await db.prepare('SELECT id FROM words WHERE lemma = ? AND pos = ?').bind(g.lemma, pos).first<{ id: string }>();
  let created = false;
  if (!have) {
    const s = l?.sentences?.find((x) => x.de.includes(g.form));
    await insertWords(db, [
      {
        lemma: g.lemma, pos, gender: pos === 'noun' && ['der', 'die', 'das'].includes(String(g.gender)) ? g.gender : null,
        level: ['B1', 'B2', 'C1'].includes(g.level) ? g.level : 'B2', level_src: 'mine',
        gloss_ko: g.gloss_ko, gloss_status: 'generated',
        example_de: s?.de ?? null, example_ko: s?.ko ?? null, example_src: s ? `article:${articleId}` : null,
        pinned: 1,
      },
    ]);
    have = await db.prepare('SELECT id FROM words WHERE lemma = ? AND pos = ?').bind(g.lemma, pos).first<{ id: string }>();
    if (!have) throw new HttpError(500, 'insert_failed');
    created = true;
    // 「내가 넣은 단어」 목록에도 남긴다(넣은 날 · 출처 기사)
    await db
      .prepare("INSERT INTO word_requests(text, url, created_at, status, word_id, note) VALUES (?, ?, ?, 'added', ?, ?)")
      .bind(g.lemma, row.url.startsWith('https://') ? row.url : null, now.toISOString(), have.id, '기사에서 바로')
      .run();
  }
  const t = await studyToday(db, have.id, now);
  return { ...t, id: have.id, created };
}

const postAddFromArticle = async ({ req, env, params: [id] }: Ctx) => {
  const body = (await req.json().catch(() => null)) as { lemma?: unknown } | null;
  return Response.json(await addFromArticle(env.DB, Number(id), body?.lemma));
};

const SEP = ['zurück', 'zusammen', 'weiter', 'durch', 'über', 'unter', 'nach', 'fest', 'fort', 'heim', 'hin', 'her', 'los', 'mit', 'vor', 'weg', 'auf', 'aus', 'bei', 'ein', 'an', 'ab', 'um', 'zu', 'dar'];
const ENDINGS = ['ten', 'tet', 'test', 'est', 'en', 'em', 'er', 'es', 'st', 'te', 'e', 'n', 's', 't'];

/** 본문 낱말 꼴 → 기본형 후보(앞쪽일수록 그럴듯). 대문자로 시작한 꼴(명사)·소문자 꼴 둘 다 */
export function lemmaCandidates(form: string): string[] {
  const f = form.trim().replace(/[^A-Za-zÄÖÜäöüß-]/g, '');
  if (f.length < 2) return [];
  const low = f.toLowerCase();
  const out: string[] = [f, low, low[0].toUpperCase() + low.slice(1)];
  const verb = (stem: string) => out.push(stem + 'en', stem + 'n');
  for (const e of ENDINGS) {
    if (low.length - e.length < 3 || !low.endsWith(e)) continue;
    const b = low.slice(0, -e.length);
    out.push(b, b[0].toUpperCase() + b.slice(1));
    verb(b);
  }
  // 과거분사: gemacht → machen, eingeleitet → einleiten, gefunden → finden
  const pp = (rest: string, pre = '') => {
    const m = /^ge(.{2,}?)(et|t|en)$/.exec(rest);
    if (m) verb(pre + m[1]);
  }
  pp(low);
  for (const p of SEP) if (low.startsWith(p + 'ge')) pp(low.slice(p.length), p);
  // zu 부정사: einzuleiten → einleiten
  for (const p of SEP) if (low.startsWith(p + 'zu') && low.length > p.length + 4) out.push(p + low.slice(p.length + 2));
  return [...new Set(out)].filter((x) => x.length >= 2).slice(0, 40);
}

export async function lookup(db: D1Database, form: string): Promise<LookupResponse> {
  const cands = lemmaCandidates(form);
  if (!cands.length) return { items: [] };
  const all = [...cands, ...cands.map((c) => 'sich ' + c)];
  const r = await db
    .prepare(
      `SELECT w.id, w.lemma, w.pos, w.gender, w.gloss_ko, w.level, c.state, c.reps, c.suspended FROM words w LEFT JOIN cards c ON c.word_id = w.id
       WHERE w.lemma IN (${all.map(() => '?').join(',')})`,
    )
    .bind(...all)
    .all<{ id: string; lemma: string; pos: string; gender: string | null; gloss_ko: string | null; level: string; state: number | null; reps: number | null; suspended: number | null }>();
  const rank = (lemma: string) => {
    const i = all.indexOf(lemma);
    return i < 0 ? 999 : i % cands.length;
  };
  const items = r.results
    .sort((a, b) => rank(a.lemma) - rank(b.lemma))
    .slice(0, 3)
    .map((x) => ({
      id: x.id, lemma: x.lemma, pos: x.pos, gender: x.gender, gloss_ko: x.gloss_ko, level: x.level,
      learned: Number(x.reps ?? 0) > 0, suspended: Number(x.suspended ?? 0) === 1,
    }));
  return { items };
}

const getLookup = async ({ env, url }: Ctx) => {
  const form = url.searchParams.get('form') ?? '';
  if (form.length > 60) throw bad('bad_form');
  return Response.json(await lookup(env.DB, form));
};

export const STUDY_ROUTES: Array<[string, RegExp, (c: Ctx) => Promise<Response>]> = [
  ['POST', /^\/api\/word\/([\w-]+)\/today$/, postStudyToday],
  ['POST', /^\/api\/articles\/(\d+)\/add-word$/, postAddFromArticle],
  ['GET', /^\/api\/lookup$/, getLookup],
];
