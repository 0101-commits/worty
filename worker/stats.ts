// v11 단어 · 기록 화면용 질의: 기록 요약(이번 주 · 달력 · 자주 틀린 단어 · 복습 예정 · 진도), 단어 바로가기 숫자, 카드 제외.
// SQL 은 D1(SQLite)·Postgres 공용 꼴 — 다른 곳만 db.ts 도우미. 시험: tests/v11-phase3.test.mjs · tests/pg-backend.test.mjs.
import type { Level, Pos, RecordsResponse, WordsCountsResponse } from '../shared/api.ts';
import type { Env } from './env.ts';
import { DAY_START_H, addDays, studyDay, studyDayStartUtc } from './time.ts';
import { dayOf } from './db.ts';
import { HttpError, bad } from './http.ts';
import { clearMemo, memo } from './memo.ts';

interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  params: string[];
}

/** 자주 틀림 = 잊은 횟수 2 이상 */
export const WEAK_MIN = 2;
export const POS_SET = new Set(['noun', 'verb', 'adj', 'adv', 'prep', 'conj', 'pron', 'num', 'phrase', 'other']);
const LEVELS: Level[] = ['B1', 'B2', 'C1'];
const num = (v: unknown) => Number(v ?? 0);
const rows = (r: D1Result) => r.results as Record<string, unknown>[];

/** 월요일(학습일) — day 가 속한 주의 시작 */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = 일요일
  return addDays(day, -((dow + 6) % 7));
}

/** GET /api/words/counts — 바로가기 칩 숫자(자주 틀림 · 이번 주). 120초 기억 */
export async function wordsCounts({ env }: Ctx): Promise<Response> {
  const day = studyDay();
  const out = await memo(env.DB, `words-counts|${day}`, 120_000, async () => {
    const [weak, week] = await env.DB.batch([
      env.DB.prepare(`SELECT count(*) AS n FROM cards WHERE lapses >= ${WEAK_MIN}`),
      env.DB.prepare('SELECT count(*) AS n FROM cards WHERE introduced_at >= ?').bind(studyDayStartUtc(addDays(day, -6))),
    ]);
    return { weak: num(rows(weak)[0]?.n), week: num(rows(week)[0]?.n) } satisfies WordsCountsResponse;
  });
  return Response.json(out);
}

/** GET /api/stats/records */
export async function records({ env }: Ctx): Promise<Response> {
  const today = studyDay();
  const monday = weekStart(today);
  const monthStart = `${today.slice(0, 8)}01`;
  const since = monday < monthStart ? monday : monthStart;
  const forecastEnd = addDays(today, 7);
  const [days, due, weak] = await env.DB.batch([
    // 날짜별 채점 수와 X(다시) 수. 학습일 = 한국 시각 − 4시간의 날짜
    env.DB.prepare(
      `SELECT ${dayOf(env.DB, 'reviewed_at', 9 - DAY_START_H)} AS day, count(*) AS n, sum(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS x
       FROM reviews WHERE reviewed_at >= ? AND undone = 0 AND (session_id IS NULL OR session_id != 'practice') GROUP BY day ORDER BY day`,
    ).bind(studyDayStartUtc(since)),
    // 앞으로 7학습일 안에 올 카드(밀린 카드 포함) — 날짜별
    env.DB.prepare(
      `SELECT ${dayOf(env.DB, 'due', 9 - DAY_START_H)} AS day, count(*) AS n
       FROM cards WHERE state IN (1, 2, 3) AND suspended = 0 AND due < ? GROUP BY day ORDER BY day`,
    ).bind(studyDayStartUtc(forecastEnd)),
    // 자주 틀린 단어: 잊은 횟수 많은 순, 같으면 최근에 본 것 먼저
    env.DB.prepare(
      `SELECT w.id, w.lemma, w.pos, w.gender, w.level, w.gloss_ko, c.lapses AS x
       FROM cards c JOIN words w ON w.id = c.word_id
       WHERE c.lapses >= ${WEAK_MIN} ORDER BY c.lapses DESC, c.last_review DESC, w.seq LIMIT 8`,
    ),
  ]);
  const perDay = new Map(rows(days).map((r) => [String(r.day), { n: num(r.n), x: num(r.x) }]));

  let weekDays = 0;
  let weekReviews = 0;
  let weekX = 0;
  for (const [d, v] of perDay) {
    if (d < monday || d > today) continue;
    weekDays++;
    weekReviews += v.n;
    weekX += v.x;
  }
  const month: Array<{ day: string; count: number }> = [];
  for (let d = monthStart; d <= today; d = addDays(d, 1)) month.push({ day: d, count: perDay.get(d)?.n ?? 0 });

  const dueBy = new Map<string, number>();
  for (const r of rows(due)) {
    const d = String(r.day) < today ? today : String(r.day); // 밀린 카드는 오늘에
    dueBy.set(d, (dueBy.get(d) ?? 0) + num(r.n));
  }
  const forecast = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i);
    return { day, count: dueBy.get(day) ?? 0 };
  });

  const level = await memo(env.DB, 'records-progress', 120_000, async () =>
    rows(
      await env.DB.prepare(
        `SELECT w.level AS level, count(*) AS total, sum(CASE WHEN c.state <> 0 THEN 1 ELSE 0 END) AS learned
         FROM words w JOIN cards c ON c.word_id = w.id GROUP BY w.level`,
      ).all(),
    ),
  );
  const progress = { B1: { learned: 0, total: 0 }, B2: { learned: 0, total: 0 }, C1: { learned: 0, total: 0 } } as RecordsResponse['progress'];
  for (const r of level) {
    const lv = String(r.level) as Level;
    if (LEVELS.includes(lv)) progress[lv] = { learned: num(r.learned), total: num(r.total) };
  }

  return Response.json({
    week: { days: weekDays, reviews: weekReviews, correct: weekReviews - weekX },
    month: { month: today.slice(0, 7), days: month },
    weak: rows(weak).map((r) => ({
      id: String(r.id),
      lemma: String(r.lemma),
      pos: String(r.pos) as Pos,
      gender: r.gender == null ? null : String(r.gender),
      level: String(r.level) as Level,
      gloss_ko: r.gloss_ko == null ? null : String(r.gloss_ko),
      x: num(r.x),
    })),
    forecast,
    progress,
  } satisfies RecordsResponse);
}

/** POST /api/word/:id/suspend {suspended: boolean} — 단어 「제외」(카드 쉬게 하기) · 되돌리기. suspended_at 은 비워 30일 뒤 저절로 깨우지 않는다(내가 정한 제외) */
export async function suspendWord({ req, env, params: [id] }: Ctx): Promise<Response> {
  let body: { suspended?: unknown };
  try {
    body = (await req.json()) as { suspended?: unknown };
  } catch {
    throw bad('invalid_json');
  }
  if (typeof body?.suspended !== 'boolean') throw bad('suspended must be boolean');
  const r = await env.DB.prepare('UPDATE cards SET suspended = ?, suspended_at = NULL WHERE word_id = ?')
    .bind(body.suspended ? 1 : 0, id)
    .run();
  if (!(r.meta.changes ?? 0)) throw new HttpError(404, 'not_found');
  clearMemo(env.DB);
  return Response.json({ ok: true, suspended: body.suspended });
}
