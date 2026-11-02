// 오늘의 기사 · 저장한 표현(v11 4단계, 2026-11-02). 길은 ARTICLE_ROUTES 로 index.ts 에 붙는다.
// 기사는 평일 11:05 KST 작업(scripts/articles/run.mjs)이 골라 공부 자료(lesson JSON)와 함께 /api/admin/articles 로 넣는다.
// SQL 은 D1·Postgres 공용 꼴(upsert = ON CONFLICT … DO UPDATE, excluded.* 는 두 DB 모두 됨).
import type { Card, Rating } from '../shared/api.ts';
import { applyRating } from './fsrs.ts';
import type { Env } from './env.ts';
import { bad, HttpError } from './http.ts';
import { kstDay } from './time.ts';

interface Ctx { req: Request; env: Env; url: URL; params: string[] }
type Handler = (c: Ctx) => Promise<Response>;
const json = (data: unknown, status = 200) => Response.json(data, { status });

/** 하루에 여는 「한 편 더」 한도(v10 결정 D3) */
export const MORE_PER_DAY = 3;
/** 본문 보관 일수(D1 안전장치) */
export const BODY_DAYS = 30;

type ArticleRow = {
  id: number; source: string; ext_id: string; url: string; title: string; category: string | null; published_at: string;
  day: string; role: string; body: string | null; words: number; score: number | null; lesson: string | null;
  status: string; opened_at: string | null; done_at: string | null; quiz_score: number | null; created_at: string;
};

const LIST_COLS = 'id, source, url, title, category, published_at, day, role, words, status, opened_at, done_at, quiz_score';

function parseLesson(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** 공부 자료 낱말 → 단어장에 있는지(id · 레벨 · 배웠는지). 60개까지 한 질의 */
async function deckStatus(db: D1Database, lesson: unknown) {
  const g = (lesson as { glossary?: Array<{ lemma?: string }> } | null)?.glossary ?? [];
  const lemmas = [...new Set(g.map((x) => String(x?.lemma ?? '')).filter(Boolean))].slice(0, 60);
  if (!lemmas.length) return {};
  const r = await db
    .prepare(`SELECT w.id, w.lemma, w.level, c.reps FROM words w LEFT JOIN cards c ON c.word_id = w.id WHERE w.lemma IN (${lemmas.map(() => '?').join(',')})`)
    .bind(...lemmas)
    .all<{ id: string; lemma: string; level: string; reps: number | null }>();
  return Object.fromEntries(r.results.map((x) => [x.lemma, { id: x.id, level: x.level, learned: Number(x.reps ?? 0) > 0 }]));
}

async function full(db: D1Database, row: ArticleRow) {
  const lesson = parseLesson(row.lesson);
  const saved = await db.prepare('SELECT base FROM expressions WHERE article_id = ?').bind(row.id).all<{ base: string }>();
  return {
    id: row.id, url: row.url, title: row.title, category: row.category, published_at: row.published_at, day: row.day, role: row.role,
    words: row.words, status: row.status, quiz_score: row.quiz_score, has_body: Boolean(row.body),
    lesson, deck: await deckStatus(db, lesson), saved: saved.results.map((x) => x.base),
  };
}

/** 오늘 기사: 오늘(KST) main → 없으면(주말·11시 전) 가장 최근 main. 남은 「한 편 더」 수 함께 */
const today: Handler = async ({ env }) => {
  const day = kstDay();
  const row = await env.DB.prepare(`SELECT * FROM articles WHERE role = 'main' AND day <= ? ORDER BY day DESC, id DESC LIMIT 1`).bind(day).first<ArticleRow>();
  const opened = await env.DB.prepare(`SELECT COUNT(*) AS n FROM articles WHERE role = 'extra' AND day = ? AND status <> 'ready'`).bind(day).first<{ n: number }>();
  const ready = await env.DB.prepare(`SELECT COUNT(*) AS n FROM articles WHERE role = 'extra' AND day = ? AND status = 'ready'`).bind(day).first<{ n: number }>();
  const left = Math.max(0, Math.min(MORE_PER_DAY - Number(opened?.n ?? 0), Number(ready?.n ?? 0)));
  return json({ day, article: row ? await full(env.DB, row) : null, is_today: row?.day === day, more_left: left });
};

const list: Handler = async ({ env, url }) => {
  const limit = Math.min(60, Math.max(1, Number(url.searchParams.get('limit')) || 30));
  const r = await env.DB.prepare(
    `SELECT ${LIST_COLS}, (SELECT COUNT(*) FROM expressions e WHERE e.article_id = articles.id) AS saved
     FROM articles WHERE status <> 'ready' OR role = 'main' ORDER BY day DESC, id DESC LIMIT ?`,
  ).bind(limit).all();
  return json({ items: r.results });
};

const one: Handler = async ({ env, params }) => {
  const row = await env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(Number(params[0])).first<ArticleRow>();
  if (!row) throw new HttpError(404, 'no_article');
  return json(await full(env.DB, row));
};

/** 진행 적기: { opened?: true, done?: true, quiz_score?: 0~4 } */
const progress: Handler = async ({ env, req, params }) => {
  const b = (await req.json().catch(() => ({}))) as { opened?: boolean; done?: boolean; quiz_score?: number };
  const id = Number(params[0]);
  const now = new Date().toISOString();
  if (b.opened) await env.DB.prepare(`UPDATE articles SET opened_at = COALESCE(opened_at, ?), status = CASE WHEN status = 'ready' THEN 'opened' ELSE status END WHERE id = ?`).bind(now, id).run();
  if (b.done) {
    const q = Number.isInteger(b.quiz_score) ? Math.max(0, Math.min(4, Number(b.quiz_score))) : null;
    await env.DB.prepare(`UPDATE articles SET done_at = ?, status = 'done', quiz_score = COALESCE(?, quiz_score), opened_at = COALESCE(opened_at, ?) WHERE id = ?`).bind(now, q, now, id).run();
  }
  return json({ ok: true });
};

/** 「한 편 더」: 오늘 준비된 extra 중 점수 높은 것 하나를 연다(하루 MORE_PER_DAY 편) */
const more: Handler = async ({ env }) => {
  const day = kstDay();
  const opened = await env.DB.prepare(`SELECT COUNT(*) AS n FROM articles WHERE role = 'extra' AND day = ? AND status <> 'ready'`).bind(day).first<{ n: number }>();
  if (Number(opened?.n ?? 0) >= MORE_PER_DAY) return json({ article: null, reason: 'limit' });
  const row = await env.DB.prepare(`SELECT * FROM articles WHERE role = 'extra' AND day = ? AND status = 'ready' ORDER BY score DESC, id LIMIT 1`).bind(day).first<ArticleRow>();
  if (!row) return json({ article: null, reason: 'none' });
  await env.DB.prepare(`UPDATE articles SET status = 'opened', opened_at = ? WHERE id = ?`).bind(new Date().toISOString(), row.id).run();
  return json({ article: await full(env.DB, { ...row, status: 'opened' }) });
};

// ---------- 저장한 표현 ----------

type ExprRow = {
  id: number; article_id: number | null; base: string; meaning_ko: string; sentence: string | null; created_at: string;
  state: number; due: string; stability: number; difficulty: number; elapsed_days: number; scheduled_days: number;
  learning_steps: number; reps: number; lapses: number; last_review: string | null;
};
const EXPR_COLS = 'id, article_id, base, meaning_ko, sentence, created_at, state, due, reps, lapses, last_review';

const exprList: Handler = async ({ env }) => {
  const r = await env.DB.prepare(`SELECT ${EXPR_COLS} FROM expressions ORDER BY id DESC LIMIT 500`).all();
  return json({ items: r.results });
};

/** { article_id, items: [{ base, meaning_ko, sentence }] } — 같은 기본꼴은 한 번만 */
const exprSave: Handler = async ({ env, req }) => {
  const b = (await req.json().catch(() => null)) as { article_id?: number; items?: Array<{ base?: string; meaning_ko?: string; sentence?: string }> } | null;
  const items = (b?.items ?? []).filter((x) => x?.base && x?.meaning_ko).slice(0, 20);
  if (!items.length) throw bad('no items');
  const now = new Date().toISOString();
  const stmt = env.DB.prepare(
    `INSERT INTO expressions(article_id, base, meaning_ko, sentence, created_at, due) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (base) DO UPDATE SET meaning_ko = excluded.meaning_ko`,
  );
  await env.DB.batch(items.map((x) => stmt.bind(b?.article_id ?? null, String(x.base).slice(0, 120), String(x.meaning_ko).slice(0, 80), x.sentence ? String(x.sentence).slice(0, 400) : null, now, now)));
  return json({ saved: items.length });
};

const exprDelete: Handler = async ({ env, params }) => {
  await env.DB.prepare('DELETE FROM expressions WHERE id = ?').bind(Number(params[0])).run();
  return json({ ok: true });
};

/** 오늘 복습할 표현(새 것 포함), limit 개 */
const exprDue: Handler = async ({ env, url }) => {
  const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit')) || 3));
  const r = await env.DB.prepare(`SELECT ${EXPR_COLS} FROM expressions WHERE due <= ? ORDER BY state, due LIMIT ?`).bind(new Date().toISOString(), limit).all();
  return json({ items: r.results });
};

/** 표현을 카드 꼴로 바꿔 같은 FSRS 계산을 쓴다(word_id = 'e' + id: 흔들림 씨앗) */
export function exprCard(x: ExprRow): Card {
  return {
    word_id: `e${x.id}`, state: x.state as Card['state'], due: x.due, stability: x.stability, difficulty: x.difficulty,
    elapsed_days: x.elapsed_days, scheduled_days: x.scheduled_days, learning_steps: x.learning_steps, reps: x.reps,
    lapses: x.lapses, last_review: x.last_review, introduced_at: null, suspended: 0,
  };
}

const exprGrade: Handler = async ({ env, req, params }) => {
  const b = (await req.json().catch(() => ({}))) as { rating?: number };
  const rating = Number(b.rating);
  if (![1, 2, 3, 4].includes(rating)) throw bad('bad rating');
  const row = await env.DB.prepare('SELECT * FROM expressions WHERE id = ?').bind(Number(params[0])).first<ExprRow>();
  if (!row) throw new HttpError(404, 'no_expression');
  const { nextRow: n } = applyRating(exprCard(row), rating as Rating, new Date());
  await env.DB.prepare(
    `UPDATE expressions SET state = ?, due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?, last_review = ? WHERE id = ?`,
  ).bind(n.state, n.due, n.stability, n.difficulty, n.elapsed_days, n.scheduled_days, n.learning_steps, n.reps, n.lapses, n.last_review, row.id).run();
  return json({ due: n.due, state: n.state });
};

// ---------- 관리(작업) ----------

type InArticle = Partial<ArticleRow> & { lesson?: unknown };

/** 작업이 고른 기사 넣기/고치기. 같은 (source, ext_id)면 공부 자료·점수만 바꾼다 */
const adminPut: Handler = async ({ env, req }) => {
  const b = (await req.json().catch(() => null)) as { items?: InArticle[] } | null;
  const items = (b?.items ?? []).filter((x) => x?.source && x?.ext_id && x?.url && x?.title && x?.day).slice(0, 10);
  if (!items.length) throw bad('no items');
  const now = new Date().toISOString();
  const stmt = env.DB.prepare(
    `INSERT INTO articles(source, ext_id, url, title, category, published_at, day, role, body, words, score, lesson, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (source, ext_id) DO UPDATE SET lesson = excluded.lesson, score = excluded.score, words = excluded.words`,
  );
  await env.DB.batch(items.map((x) => stmt.bind(
    x.source, String(x.ext_id), x.url, String(x.title).slice(0, 300), x.category ?? null, x.published_at ?? now, x.day,
    x.role === 'main' ? 'main' : 'extra', x.body ?? null, Number(x.words) || 0, x.score ?? null,
    x.lesson == null ? null : typeof x.lesson === 'string' ? x.lesson : JSON.stringify(x.lesson), now,
  )));
  return json({ saved: items.length });
};

/** 작업용: 이미 넣은 기사 번호 + 최근 main 분야(겹침 피하기) */
const adminKnown: Handler = async ({ env, url }) => {
  const since = url.searchParams.get('since') ?? '0000-00-00';
  const r = await env.DB.prepare(`SELECT source, ext_id, day, role, category FROM articles WHERE day >= ? ORDER BY day DESC, id DESC LIMIT 400`).bind(since).all<{ source: string; ext_id: string; day: string; role: string; category: string | null }>();
  return json({ items: r.results });
};

/** 본문 지우기(BODY_DAYS 일 지난 것) */
const adminPurge: Handler = async ({ env }) => {
  const before = new Date(Date.now() - BODY_DAYS * 86400_000).toISOString();
  const r = await env.DB.prepare('UPDATE articles SET body = NULL WHERE body IS NOT NULL AND created_at < ?').bind(before).run();
  return json({ purged: r.meta?.changes ?? 0 });
};

export const ARTICLE_ROUTES: Array<[string, RegExp, Handler, boolean?]> = [
  ['GET', /^\/api\/articles\/today$/, today],
  ['POST', /^\/api\/articles\/more$/, more],
  ['GET', /^\/api\/articles$/, list],
  ['GET', /^\/api\/articles\/(\d+)$/, one],
  ['POST', /^\/api\/articles\/(\d+)\/progress$/, progress],
  ['GET', /^\/api\/expressions$/, exprList],
  ['POST', /^\/api\/expressions$/, exprSave],
  ['GET', /^\/api\/expressions\/due$/, exprDue],
  ['DELETE', /^\/api\/expressions\/(\d+)$/, exprDelete],
  ['POST', /^\/api\/expressions\/(\d+)\/grade$/, exprGrade],
  ['POST', /^\/api\/admin\/articles$/, adminPut],
  ['GET', /^\/api\/admin\/articles\/known$/, adminKnown],
  ['POST', /^\/api\/admin\/articles\/purge$/, adminPurge],
];
