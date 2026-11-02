// 오늘의 기사 · 저장한 표현(v11 4단계): 서버 길 + 목업 자료 + 폰 독일어 음성(D6 결정: 폰 내장 음성)
import { MOCK, request } from './api.ts'

export type Gloss = { form: string; lemma: string; pos: string; gender: 'der' | 'die' | 'das' | null; gloss_ko: string; level: string }
export type Expr = { base: string; meaning_ko: string; s: number }
export type Quiz =
  | { type: 'topic' | 'detail'; q_ko: string; options: string[]; answer: number }
  | { type: 'article'; noun: string; answer: 'der' | 'die' | 'das'; s: number }
  | { type: 'cloze'; text: string; options: string[]; answer: number; s: number }
export type Lesson = { summary_ko: string[]; key: string[]; sentences: Array<{ de: string; ko: string }>; glossary: Gloss[]; expressions: Expr[]; quiz: Quiz[] }
export type Article = {
  id: number; url: string; title: string; category: string | null; published_at: string; day: string; role: 'main' | 'extra';
  words: number; status: 'ready' | 'opened' | 'done'; quiz_score: number | null; has_body: boolean;
  lesson: Lesson | null; deck: Record<string, { id: string; level: string; learned: boolean }>; saved: string[]
}
export type ArticleRow = Pick<Article, 'id' | 'url' | 'title' | 'category' | 'day' | 'role' | 'words' | 'status' | 'quiz_score'> & { saved: number }
export type SavedExpr = { id: number; article_id: number | null; base: string; meaning_ko: string; sentence: string | null; state: number; due: string; reps: number; lapses: number }

const mock = <T,>(v: T) => Promise.resolve(structuredClone(v))

export const articleApi = {
  today: () => (MOCK ? mock(MOCK_TODAY) : request<{ day: string; article: Article | null; is_today: boolean; more_left: number }>('GET', '/api/articles/today')),
  list: () => (MOCK ? mock({ items: MOCK_LIST }) : request<{ items: ArticleRow[] }>('GET', '/api/articles?limit=30')),
  one: (id: number) => (MOCK ? mock(MOCK_TODAY.article) : request<Article>('GET', `/api/articles/${id}`)),
  more: () => (MOCK ? mock({ article: null, reason: 'none' as const }) : request<{ article: Article | null; reason?: 'limit' | 'none' }>('POST', '/api/articles/more')),
  progress: (id: number, body: { opened?: boolean; done?: boolean; quiz_score?: number }) =>
    MOCK ? mock({ ok: true }) : request<{ ok: boolean }>('POST', `/api/articles/${id}/progress`, body),
  exprs: () => (MOCK ? mock({ items: MOCK_EXPRS }) : request<{ items: SavedExpr[] }>('GET', '/api/expressions')),
  exprDue: (limit = 10) => (MOCK ? mock({ items: MOCK_EXPRS }) : request<{ items: SavedExpr[] }>('GET', `/api/expressions/due?limit=${limit}`)),
  saveExprs: (article_id: number, items: Array<{ base: string; meaning_ko: string; sentence?: string }>) =>
    MOCK ? mock({ saved: items.length }) : request<{ saved: number }>('POST', '/api/expressions', { article_id, items }),
  delExpr: (id: number) => (MOCK ? mock({ ok: true }) : request<{ ok: boolean }>('DELETE', `/api/expressions/${id}`)),
  gradeExpr: (id: number, rating: 1 | 3) => (MOCK ? mock({ ok: true }) : request<unknown>('POST', `/api/expressions/${id}/grade`, { rating })),
}

/** 폰 독일어 음성으로 읽기. 음성이 없으면 false */
export function speak(text: string, rate = 0.9): boolean {
  const s = typeof window !== 'undefined' ? window.speechSynthesis : undefined
  if (!s) return false
  s.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'de-DE'
  u.rate = rate
  const v = s.getVoices().find((x) => x.lang?.toLowerCase().startsWith('de'))
  if (v) u.voice = v
  s.speak(u)
  return true
}
export const stopSpeak = () => window.speechSynthesis?.cancel()

/** 기사 읽기 글자 크기(17 · 19 · 21), 이 기기에만 */
const FS_KEY = 'worty.readFs'
export function readFs(): number {
  try {
    const n = Number(localStorage.getItem(FS_KEY))
    return [17, 19, 21].includes(n) ? n : 19
  } catch {
    return 19
  }
}
export function saveReadFs(n: number) {
  try {
    localStorage.setItem(FS_KEY, String(n))
  } catch {
    /* 저장 못 해도 이번엔 쓴다 */
  }
}

/** 문장을 낱말 뜻 조각으로 나눈다: [{t, g?}] — g 가 있으면 누를 수 있는 낱말 */
export function tokenize(de: string, glossary: Gloss[]): Array<{ t: string; g?: Gloss }> {
  const forms = [...glossary].sort((a, b) => b.form.length - a.form.length)
  const out: Array<{ t: string; g?: Gloss }> = []
  let rest = de
  while (rest) {
    let best: { i: number; g: Gloss } | null = null
    for (const g of forms) {
      const re = new RegExp(`(^|[^A-Za-zÄÖÜäöüß])(${g.form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^A-Za-zÄÖÜäöüß])`)
      const m = re.exec(rest)
      if (m && (best === null || m.index + m[1].length < best.i)) best = { i: m.index + m[1].length, g }
    }
    if (!best) {
      out.push({ t: rest })
      break
    }
    if (best.i > 0) out.push({ t: rest.slice(0, best.i) })
    out.push({ t: best.g.form, g: best.g })
    rest = rest.slice(best.i + best.g.form.length)
  }
  return out
}

// ───────── 목업(화면 게이트용, 11-02 실제 기사 앞부분) ─────────
const MOCK_LESSON: Lesson = {
  summary_ko: ['한국 금융 당국이 국내 암호화폐 거래소 보안 점검을 시작했다.', '계기는 세계 최대 거래소 바이낸스 해킹이다.', '위원회는 11월 5일 금융권 전체 보안 점검 회의를 연다.'],
  key: ['Sicherheitsüberprüfung', 'einleiten', 'Vertreter'],
  sentences: [
    { de: 'Die südkoreanischen Finanzbehörden haben eine Sicherheitsüberprüfung bei inländischen Kryptowährungsbörsen eingeleitet.', ko: '한국 금융 당국이 국내 암호화폐 거래소 보안 점검을 시작했다.' },
    { de: 'Anlass ist der jüngste Hackerangriff auf die weltgrößte Kryptobörse Binance.', ko: '계기는 세계 최대 거래소 바이낸스에 대한 최근 해킹이다.' },
    { de: 'Die Finanzdienstekommission lud Vertreter großer Börsen zu einer dringend einberufenen Sitzung ein.', ko: '금융위원회는 대형 거래소 대표들을 급히 소집한 회의에 불렀다.' },
  ],
  glossary: [
    { form: 'Sicherheitsüberprüfung', lemma: 'Sicherheitsüberprüfung', pos: 'noun', gender: 'die', gloss_ko: '보안 점검', level: 'C1' },
    { form: 'eingeleitet', lemma: 'einleiten', pos: 'verb', gender: null, gloss_ko: '시작하다, 개시하다', level: 'B2' },
    { form: 'Anlass', lemma: 'Anlass', pos: 'noun', gender: 'der', gloss_ko: '계기', level: 'B2' },
    { form: 'Vertreter', lemma: 'Vertreter', pos: 'noun', gender: 'der', gloss_ko: '대표', level: 'B1' },
    { form: 'einberufenen', lemma: 'einberufen', pos: 'verb', gender: null, gloss_ko: '소집하다', level: 'C1' },
  ],
  expressions: [
    { base: 'eine Überprüfung einleiten', meaning_ko: '점검을 시작하다', s: 0 },
    { base: 'jemanden zu etwas einladen', meaning_ko: '누구를 무엇에 부르다', s: 2 },
    { base: 'eine Sitzung einberufen', meaning_ko: '회의를 소집하다', s: 2 },
  ],
  quiz: [
    { type: 'topic', q_ko: '기사는 무엇에 관한 것인가요?', options: ['바이낸스가 한국 거래소를 사들인다', '해킹 뒤 금융 당국이 거래소 보안을 점검한다', '한국이 암호화폐 거래를 금지한다', '거래소가 고객 자산을 돌려준다'], answer: 1 },
    { type: 'detail', q_ko: '위원회는 누구를 회의에 불렀나요?', options: ['은행장', '대형 거래소 대표', '해커', '경찰'], answer: 1 },
    { type: 'article', noun: 'Anlass', answer: 'der', s: 1 },
    { type: 'cloze', text: 'Die Finanzdienstekommission lud Vertreter großer Börsen zu einer dringend ___ Sitzung ein.', options: ['einberufenen', 'eingeleitet', 'gestohlen', 'gültig'], answer: 0, s: 2 },
  ],
}
const MOCK_TODAY = {
  day: '2026-11-02', is_today: true, more_left: 2,
  article: {
    id: 1, url: 'https://world.kbs.co.kr/service/news_view.htm?lang=g&Seq_Code=109823', title: 'Nach Binance-Hack: Finanzdienstekommission überprüft Sicherheit inländischer Kryptobörsen',
    category: 'Wirtschaft', published_at: '2026-11-02T05:53:38.000Z', day: '2026-11-02', role: 'main' as const, words: 132, status: 'ready' as const, quiz_score: null, has_body: true,
    lesson: MOCK_LESSON, deck: { Vertreter: { id: 'w0100', level: 'B1', learned: true } }, saved: [],
  },
}
const MOCK_LIST: ArticleRow[] = [
  { id: 1, url: MOCK_TODAY.article.url, title: MOCK_TODAY.article.title, category: 'Wirtschaft', day: '2026-11-02', role: 'main', words: 132, status: 'ready', quiz_score: null, saved: 0 },
  { id: 0, url: 'https://world.kbs.co.kr/', title: 'Koreanische Exporte im Oktober auf 115 Milliarden Dollar gestiegen', category: 'Wirtschaft', day: '2026-10-30', role: 'main', words: 123, status: 'done', quiz_score: 3, saved: 2 },
]
const MOCK_EXPRS: SavedExpr[] = [
  { id: 1, article_id: 0, base: 'auf etwas abzielen', meaning_ko: '무엇을 목표로 하다', sentence: 'Die Regierung zielt mit ihrem Haushaltsplan darauf ab, …', state: 0, due: '2026-11-02T00:00:00.000Z', reps: 0, lapses: 0 },
]
