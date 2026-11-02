// 사람 확인 줄(앱 「그림 확인」 화면)에 이미 올라간 그림을 넣는다(2026-11-02 v11 G7) — 눈 검토에서 「약함」으로 나온 89장용.
// 화면의 줄 = Worker 의 「검사 대기」(KV pending/<id>.webp, GET /api/admin/pending-review). 올라간 그림을 받아 같은 단어의 대기 그림으로 다시 맡기면 줄에 선다.
//   · 남기기(좋아요) → approvePending 이 같은 그림을 다시 공개 그림으로(변화 없음) + 결정 기록 ok
//   · 다시 그리기 → 결정 기록 no → 다음 daily.mjs 가 장면과 함께 few-shot 기록(.data/image-feedback.json)에 적고 다시 그릴 목록(restyle)에 넣는다
// 사용: node scripts/review-queue.mjs <ids.json | weak.json> [--dry]   (파일 = id 문자열 배열 또는 {id} 객체 배열). APP_URL · API_TOKEN 필요(.env)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ID_RE = /^w\d{4,6}$/;

/** 파일 내용 → id 목록(형식이 맞는 것만, 중복 제거) */
export function parseIds(json) {
  const arr = Array.isArray(json) ? json : [];
  return [...new Set(arr.map((x) => (typeof x === 'string' ? x : x?.id)).filter((id) => typeof id === 'string' && ID_RE.test(id)))];
}

export async function queueExisting(ids, { base, token, dry = false, fetchFn = fetch, say = console.log } = {}) {
  const out = { queued: [], failed: [] };
  for (const id of ids) {
    try {
      const img = await fetchFn(`${base}/img/${id}.webp`);
      if (!img.ok) throw new Error(`그림 받기 ${img.status}`);
      const buf = Buffer.from(await img.arrayBuffer());
      if (dry) {
        out.queued.push(id);
        continue;
      }
      const put = await fetchFn(`${base}/api/admin/pending/${id}`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/webp' }, body: buf });
      if (!put.ok) throw new Error(`대기 맡기기 ${put.status}`);
      out.queued.push(id);
    } catch (e) {
      out.failed.push({ id, error: String(e.message || e).slice(0, 120) });
      say(`건너뜀 ${id}: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await import('./admin.mjs'); // .env 를 읽는다
  const file = process.argv[2];
  if (!file) throw new Error('사용: node scripts/review-queue.mjs <weak.json> [--dry]');
  const ids = parseIds(JSON.parse(readFileSync(file, 'utf8')));
  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  const dry = process.argv.includes('--dry');
  const r = await queueExisting(ids, { base, token: process.env.API_TOKEN, dry });
  console.log(`${dry ? '[dry] ' : ''}확인 줄에 ${r.queued.length}/${ids.length}장 ${dry ? '넣을 수 있음' : '넣음'}${r.failed.length ? ` · 실패 ${r.failed.length}` : ''}`);
}
