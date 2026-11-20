// 아침 요약 한 통(v13 G2 · summary.yml 매일 08:30 KST 예약 — 실제로는 몇 시간 늦을 수 있음).
// 「조용함 = 정상」인지 「알림 빠짐」인지 구분하려고 문제 없는 날도 보낸다(결정 D8).
// 1) 알림 시계 상태 확인 = 앱 밖에서 한 번 더 고치기(멈췄으면 Worker 가 다시 맞추고 healed 를 돌려줌)
// 2) 단어·그림 수와 하루 전 기준값 3) 지난 24시간 깃허브 작업 성공/실패 4) 최근 공부 알림 행
// 실행 기록이 공개라 웹후크 주소·글 본문은 찍지 않는다(보냄/실패와 상태 코드만).
// 쓰기: node scripts/summary.mjs [--dry]   필요: APP_URL · API_TOKEN · DISCORD_WEBHOOK_URL · GITHUB_TOKEN · GITHUB_REPOSITORY
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DRY = process.argv.includes('--dry');
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const BASE = (process.env.APP_URL ?? '').replace(/\/$/, '');
const AUTH = { authorization: `Bearer ${process.env.API_TOKEN}` };

async function app(path, method = 'GET') {
  try {
    const r = await fetch(BASE + path, { method, headers: AUTH });
    if (!r.ok) return { error: `${r.status}` };
    return await r.json();
  } catch (e) {
    return { error: String(e).slice(0, 80) };
  }
}

const kst = (iso) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? '-' : new Date(t + 9 * 3_600_000).toISOString().slice(5, 16).replace('T', ' ');
};
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '-');
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

/** 지난 24시간 깃허브 작업: 작업 이름 → 성공·실패·도는 중 */
export function jobLines(runs, self = 'summary') {
  const by = new Map();
  for (const r of runs) {
    const name =
      String(r.path ?? r.name ?? '')
        .replace(/^.*\//, '')
        .replace(/\.ya?ml$/, '') || r.name;
    if (name === self) continue;
    const e = by.get(name) ?? { ok: 0, bad: 0, run: 0, badUrl: '' };
    if (r.status !== 'completed') e.run++;
    else if (r.conclusion === 'success' || r.conclusion === 'skipped') e.ok++;
    else if (r.conclusion === 'cancelled') continue;
    else {
      e.bad++;
      e.badUrl ||= r.html_url;
    }
    by.set(name, e);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([n, e]) => `${e.bad ? '✗' : '✓'} ${n} ${e.ok}${e.bad ? ` · 실패 ${e.bad} ${e.badUrl}` : ''}${e.run ? ` · 도는 중 ${e.run}` : ''}`);
}

async function githubRuns() {
  const repo = process.env.GITHUB_REPOSITORY;
  const tok = process.env.GITHUB_TOKEN;
  if (!repo || !tok) return null;
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=100&created=%3E%3D${since}`, {
      headers: {
        authorization: `Bearer ${tok}`,
        accept: 'application/vnd.github+json',
      },
    });
    if (!r.ok) return null;
    return (await r.json()).workflow_runs ?? [];
  } catch {
    return null;
  }
}

/** 공부 알림 한 줄: 알림 시계 상태 + 최근 행 */
export function alarmLines(sched, rows) {
  const out = [];
  if (sched?.error) out.push(`✗ 알림 시계 확인 실패 ${sched.error}`);
  else if (sched) {
    if (sched.healed) out.push(`✗ 알림 시계 멈춤(${kst(sched.healed)}) → 다시 맞춤`);
    const last = sched.last ? `${sched.last.kind} ${kst(sched.last.at)} ${sched.last.result}` : '기록 없음';
    const bad = /^(error|failed)/.test(sched.last?.result ?? '');
    out.push(`${bad ? '✗' : '✓'} 마지막 울림: ${last} · 다음 ${kst(sched.next)}`);
  }
  const recent = (rows ?? []).slice(0, 2).map((r) => `${r.kind} ${r.day} ${r.status}`);
  if (recent.length) out.push(`  보낸 알림: ${recent.join(' · ')}`);
  return out;
}

async function main() {
  const sched = await app('/api/admin/schedule', 'POST');
  const sum = await app('/api/admin/summary');
  const runs = await githubRuns();

  const lines = [];
  if (sum.error) lines.push(`✗ 앱 응답 ${sum.error}`);
  else {
    const dImg = sum.prev ? sign(sum.images - sum.prev.images) : '?';
    const dWords = sum.prev ? sign(sum.words - sum.prev.words) : '?';
    lines.push(`그림 ${dImg} · 단어 ${dWords} (그림 있는 단어 ${sum.images.toLocaleString()}/${sum.words.toLocaleString()} · ${pct(sum.images, sum.words)})`);
  }
  lines.push('', '**작업(24시간)**', ...(runs ? jobLines(runs) : ['? 깃허브 기록을 못 읽음']));
  lines.push('', '**공부 알림**', ...alarmLines(sched, sum.notifications));
  const bad = lines.some((l) => l.startsWith('✗'));
  const title = `${bad ? '⚠️ ' : ''}Wortling 아침 요약 ${sum.day ?? ''}`;
  const content = `**${title}**\n${lines.join('\n')}`.slice(0, 1900);

  if (DRY) {
    console.log(content);
  } else {
    const hook = process.env.DISCORD_WEBHOOK_URL;
    if (!hook) {
      console.log('디스코드 요약 못 보냄: 웹후크 없음');
    } else {
      const r = await fetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      }).catch((e) => ({ ok: false, status: String(e).slice(0, 60) }));
      console.log(`디스코드 요약 ${r.ok ? '보냄' : '실패'} ${r.status} · 문제 ${bad ? '있음' : '없음'}`);
      if (!r.ok) process.exitCode = 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
