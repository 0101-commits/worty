// KBS WORLD 독일어 뉴스(v11 4단계, 2026-11-02): RSS 읽기 · 본문 꺼내기 · 문장 나누기 · 고르기 점수. 순수 함수 + 받기 함수.
// 사용자 결정 D1(11-02): 본문 자동 받기 — 이용 조건 문구·로봇 차단을 어기는 위험을 알고 고름.
// 안전장치: 고른 기사 페이지만 한 번(요청 사이 쉼), 이름표를 단 요청, 실패해도 다시 몰아치지 않음, 본문은 30일 뒤 지움(worker/articles.ts).
export const RSS_URL = 'https://world.kbs.co.kr/rss/rss_news.htm?lang=g';
export const UA = 'worty-personal-reader/1.0 (single-user language study app; github.com/0101-commits/worty)';

const unent = (s) =>
  String(s ?? '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** RSS → [{ ext_id, url, title, category, published_at(ISO), desc }] */
export function parseKbsRss(xml) {
  const out = [];
  for (const m of String(xml ?? '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const get = (tag) => unent((m[1].match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`)) ?? [])[1] ?? '').trim();
    const url = get('link');
    const id = url.match(/Seq_Code=(\d+)/)?.[1];
    const title = get('title');
    if (!id || !title) continue;
    const raw = get('description').replace(/<br\s*\/?>/gi, ' ');
    const cat = raw.match(/^\s*\[([^\]]+)\]/)?.[1]?.trim() ?? null;
    const t = Date.parse(get('pubDate'));
    out.push({ ext_id: id, url: url.replace(/^http:/, 'https:'), title, category: cat, published_at: Number.isFinite(t) ? new Date(t).toISOString() : null, desc: raw.replace(/^\s*\[[^\]]+\]\s*:?\s*/, '').trim() });
  }
  return out;
}

/** 기사 페이지 HTML → 문단 배열(div.body_txt 안, <br><br> 로 나눔). 못 찾으면 [] */
export function extractBody(html) {
  const s = String(html ?? '');
  const i = s.search(/<div class="body_txt[^"]*">/);
  if (i < 0) return [];
  const rest = s.slice(s.indexOf('>', i) + 1);
  const end = rest.search(/<!--\s*Key word\s*-->|<!--\s*\/\/body txt\s*-->|<\/div>/);
  const inner = end < 0 ? rest : rest.slice(0, end);
  return inner
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .split(/(?:<br\s*\/?>\s*){2,}/i)
    .map((p) => unent(p.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 1);
}

const ABBR = /(?:\b(?:z\.B|bzw|ca|Dr|Prof|Nr|St|usw|u\.a|d\.h|vgl|Mio|Mrd|Jh|Str)|\b\d{1,4})\.$/;
/** 문단 → 문장(마침표·물음표·느낌표 + 공백 + 대문자/따옴표). 「2. November」·「z.B.」 같은 줄임은 안 자름 */
export function splitSentences(p) {
  const out = [];
  let cur = '';
  const parts = String(p).split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ„"«(])/);
  for (const part of parts) {
    cur = cur ? `${cur} ${part}` : part;
    if (!ABBR.test(cur)) {
      out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export const wordCount = (paras) => paras.join(' ').split(/\s+/).filter((w) => /[A-Za-zÄÖÜäöüß]/.test(w)).length;

const SKIP_TITLE = /\b(BTS|BLACKPINK|TWICE|K-?Pop|Single|Album|Spotify|Konzert|Drama|Serie)\b/i;
const sigWords = (title) => new Set((String(title).match(/\b[A-ZÄÖÜ][\wäöüß-]{4,}\b/g) ?? []).map((w) => w.toLowerCase()));

/** RSS 단계 거르기: 분야 없음(연예·문화 단신)·연예 제목·이미 넣은 것 빼기 */
export function prefilter(items, known) {
  const seen = new Set(known.map((k) => String(k.ext_id)));
  return items.filter((x) => x.category && !SKIP_TITLE.test(x.title) && !seen.has(String(x.ext_id)));
}

/**
 * 본문을 받은 후보 점수(높을수록 좋음).
 * 길이(110~250단어 1 · 80~320 0.6 · 그 밖 탈락) + 단어장 낱말 수(최대 20개까지 0.5) − 최근 main 과 같은 분야 0.3
 */
export function scoreCandidate({ words, deckHits, category }, recentCats = []) {
  const len = words >= 110 && words <= 250 ? 1 : words >= 80 && words <= 320 ? 0.6 : 0;
  if (!len) return 0;
  return Math.round((len + Math.min(deckHits, 20) / 40 - (recentCats.includes(category) ? 0.3 : 0)) * 1000) / 1000;
}

/** 같은 사건 기사는 하나만: 제목의 긴 고유 낱말(5자 이상 대문자)이 겹치면 점수 높은 쪽만 남긴다. avoid = 최근 main 제목들 */
export function dedupe(cands, avoid = []) {
  const taken = avoid.map(sigWords);
  const out = [];
  for (const c of [...cands].sort((a, b) => b.score - a.score)) {
    const w = sigWords(c.title);
    if (taken.some((t) => [...w].some((x) => t.has(x)))) continue;
    taken.push(w);
    out.push(c);
  }
  return out;
}

/** 단어장 낱말이 본문에 몇 개(서로 다른 것) 나오나 — 어림(그대로 또는 흔한 어미 뗀 꼴) */
export function deckHits(text, lemmas) {
  const set = new Set(lemmas.map((l) => String(l).replace(/^(sich|der|die|das)\s+/i, '').toLowerCase()));
  const found = new Set();
  for (const t of String(text).match(/[A-Za-zÄÖÜäöüß]{4,}/g) ?? []) {
    const k = t.toLowerCase();
    for (const s of ['', 'en', 'n', 'e', 'es', 's', 'er', 'em', 't', 'te', 'ten', 'st']) {
      if (s && !k.endsWith(s)) continue;
      const b = s ? k.slice(0, -s.length) : k;
      if (set.has(b)) {
        found.add(b);
        break;
      }
    }
  }
  return found.size;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function fetchText(url, { gapMs = 1500 } = {}) {
  await sleep(gapMs);
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xml' }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
