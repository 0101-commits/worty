// 매일 단어 작업 4/4(words.yml, hits.mjs 다음): 합성어 풀이(v13 L4).
// 10자 넘는 낱말을 AI(Flash-Lite)에 물어 조각 · 뜻 · 이음 글자를 words.parts 에 적는다. 이어 붙여 표제어와 같은 답만 받는다.
// 카드 줄바꿈 자리(src/hyphen.ts) · 뒷면 풀이 줄 · 단어 상세가 쓴다. 배우는 카드 → 아주 긴 낱말 → 배울 순서로 하루 MAX 개.
// 옵션: --dry(서버에 안 씀, 앞 12건을 보여 줌) · --max=N(하루 물을 낱말 수, 기본 250)
import { askJson } from '../ai.mjs';
import { api, kstDay, notify, requireEnv } from '../admin.mjs';
import { acceptParts, partsPrompt } from './lib.mjs';

const DRY = process.argv.includes('--dry');
const MAX = Number((process.argv.find((a) => a.startsWith('--max=')) || '').slice(6)) || 250;
const BATCH = 25;

const log = { day: kstDay(), dry: DRY, waiting: 0, asked: 0, compound: 0, none: 0, skipped: 0, failedBatches: 0, quotaOut: false, errors: [] };
const sample = [];

try {
  requireEnv();
  const items = (await api(`/api/admin/parts?limit=${MAX}`)).items;
  log.waiting = items.length;
  let fails = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    let got;
    try {
      got = acceptParts(await askJson(partsPrompt(batch)), batch);
    } catch (e) {
      // 하루 몫 소진은 정상 흐름(카드 검토 · 예문 낱말이 같은 몫을 먼저 쓴다) — 남은 것은 내일
      if (/PerDay|quota/i.test(String(e.message))) {
        log.quotaOut = true;
        break;
      }
      log.failedBatches++;
      log.errors.push(String(e.message || e).slice(0, 150));
      if (++fails >= 3) break;
      continue;
    }
    log.asked += batch.length;
    log.skipped += batch.length - got.size;
    for (const v of got.values()) v.length ? log.compound++ : log.none++;
    if (!got.size) {
      log.failedBatches++;
      if (++fails >= 3) {
        log.errors.push('3묶음 연속 받을 답 없음 — 오늘 그만');
        break;
      }
      continue;
    }
    fails = 0;
    if (DRY) {
      for (const w of batch) if (got.has(w.id) && sample.length < 12) sample.push(`${w.lemma}: ${got.get(w.id).map((x) => (x.link ? `+${x.p}` : `${x.p}(${x.ko ?? ''})`)).join(' ') || '합성어 아님'}`);
      continue;
    }
    try {
      await api('/api/admin/words', { method: 'POST', body: { items: [...got].map(([id, parts]) => ({ id, parts })) } });
    } catch (e) {
      log.failedBatches++;
      log.errors.push(`저장: ${String(e.message || e).slice(0, 150)}`);
    }
  }
} catch (e) {
  log.errors.push(String(e.message || e).slice(0, 300));
}
console.log(JSON.stringify(log));
if (DRY) for (const x of sample) console.log(`· ${x}`);
if (log.errors.length) {
  if (!DRY) await notify('error', 'Wortling 합성어 풀이 작업 오류', log.errors.slice(0, 5).join('\n'));
  process.exitCode = 1;
}
