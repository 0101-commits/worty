// 오늘의 기사 작업(v11 4단계, 2026-11-02). GitHub Actions article.yml 이 평일 11:05·17:35 KST 에 부른다.
//   --slot morning   : 그날 기사 1편(main) + 「한 편 더」 2편(extra). 쓸 만한 오늘 기사가 모자라면 전 평일 오후 기사까지 본다(D2 결정)
//   --slot afternoon : 오후에 올라온 기사로 extra 를 2편까지 더(「한 편 더」가 오후 기사도 고르게, D3)
//   --dry            : 서버에 안 쓰고 고른 것만 보여 줌
// 흐름: RSS → 거르기 → 위에서 5개만 본문 받기(요청 사이 1.5초) → 점수 · 같은 사건 하나만 → AI 공부 자료 → /api/admin/articles. 끝에 30일 지난 본문 지우기
import { api, addDays, kstDay, notify, requireEnv } from '../admin.mjs';
import { askGroqJson, askJson } from '../ai.mjs';
import { RSS_URL, dedupe, deckHits, extractBody, fetchText, parseKbsRss, prefilter, scoreCandidate, splitSentences, wordCount } from './kbs.mjs';
import { acceptLesson, lessonPrompt } from './lesson.mjs';

const args = process.argv.slice(2);
const slot = args.includes('--slot') ? args[args.indexOf('--slot') + 1] : 'morning';
const DRY = args.includes('--dry');
const FETCH_MAX = 5;

/** 전 평일(월요일이면 금요일) */
export function prevWeekday(day) {
  let d = addDays(day, -1);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, -1);
  return d;
}
const kstOf = (iso) => (iso ? kstDay(new Date(iso)) : null);

async function lessonFor(c) {
  const sentences = c.paras.flatMap(splitSentences);
  const prompt = lessonPrompt({ title: c.title, sentences });
  for (const ask of [askJson, askGroqJson]) {
    try {
      const lesson = acceptLesson(await ask(prompt), { sentences });
      if (lesson) return lesson;
      console.error(`공부 자료 모양 틀림(${c.ext_id}) — 다음 AI`);
    } catch (e) {
      console.error(`AI 실패(${c.ext_id}): ${String(e.message).slice(0, 160)}`);
    }
  }
  return null;
}

async function main() {
  requireEnv();
  const day = kstDay();
  const known = (await api(`/api/admin/articles/known?since=${addDays(day, -14)}`)).items;
  const todays = known.filter((k) => k.day === day);
  const hasMain = todays.some((k) => k.role === 'main');
  const extras = todays.filter((k) => k.role === 'extra').length;
  const wantMain = slot === 'morning' && !hasMain ? 1 : 0;
  const wantExtra = Math.max(0, 2 - (slot === 'morning' ? 0 : extras));
  if (!wantMain && !wantExtra) return console.log('오늘 몫 이미 있음');

  const rss = parseKbsRss(await fetchText(RSS_URL, { gapMs: 0 }));
  let pool = prefilter(rss, known).filter((x) => kstOf(x.published_at) === day);
  if (slot === 'morning' && pool.length < 3) {
    const prev = prevWeekday(day);
    pool = pool.concat(prefilter(rss, known).filter((x) => kstOf(x.published_at) === prev));
  }
  pool.sort((a, b) => b.desc.length - a.desc.length);
  const recentMains = known.filter((k) => k.role === 'main').slice(0, 3);
  const recentCats = recentMains.map((k) => k.category);
  const lemmas = (await api('/api/admin/keys')).items.map((w) => w.lemma);

  const cands = [];
  for (const x of pool.slice(0, FETCH_MAX)) {
    try {
      const paras = extractBody(await fetchText(x.url));
      const words = wordCount(paras);
      const c = { ...x, paras, words, deckHits: deckHits(paras.join(' '), lemmas) };
      c.score = scoreCandidate(c, recentCats);
      if (c.score > 0) cands.push(c);
    } catch (e) {
      console.error(`본문 못 받음 ${x.url}: ${e.message}`); // 다시 몰아치지 않는다 — 다음 후보로
    }
  }
  const picked = dedupe(cands, recentMains.map((k) => k.title ?? '')).slice(0, wantMain + wantExtra);
  console.log(JSON.stringify(picked.map((c) => ({ id: c.ext_id, title: c.title, words: c.words, deck: c.deckHits, score: c.score }))));
  if (DRY || !picked.length) return;

  const items = [];
  for (const [i, c] of picked.entries()) {
    const lesson = await lessonFor(c);
    if (!lesson) continue;
    items.push({
      source: 'kbs', ext_id: c.ext_id, url: c.url, title: c.title, category: c.category, published_at: c.published_at, day,
      role: i < wantMain ? 'main' : 'extra', body: c.paras.join('\n\n'), words: c.words, score: c.score, lesson,
    });
  }
  if (items.length) await api('/api/admin/articles', { method: 'POST', body: { items } });
  await api('/api/admin/articles/purge', { method: 'POST', body: {} });
  console.log(`넣음 ${items.length}/${picked.length}`);
  if (wantMain && !items.some((x) => x.role === 'main')) await notify('error', 'Worty 오늘의 기사 못 만듦', `후보 ${cands.length} · 고름 ${picked.length} · 공부 자료 ${items.length}`);
}

if (process.argv[1]?.endsWith('run.mjs')) {
  main().catch(async (e) => {
    console.error(String(e.stack || e));
    await notify('error', 'Worty 오늘의 기사 작업 실패', String(e.message || e).slice(0, 300));
    process.exit(1);
  });
}
