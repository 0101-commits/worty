// 매일 작업(daily.yml)이 .data/scenes.json · dhash.json({id: 값}) 과 image-feedback.json([{id, …, at}])을 되올릴 때 합치기(2026-11-02 v11).
// 실행이 도는 사이 main 에서도 바뀔 수 있어(kaggle 실행 · 손으로 고침) 덮어쓰면 그쪽 항목이 사라진다 → main 것 위에 이번 실행 것을 얹는다.
// 사용: node scripts/merge-state.mjs main.json run.json   (run.json 을 결과로 덮어씀, 없는 파일은 비어 있는 것으로)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** {id: 값} 두 개 → main 위에 run 을 얹음(같은 id 는 run 이 이긴다) */
export const mergeMap = (main, run) => ({ ...main, ...run });
/** [{id, at}] 두 개 → id 마다 at 이 늦은 것 하나, 최신 200개 */
export function mergeList(main, run) {
  const best = new Map();
  for (const x of [...main, ...run]) if (x?.id && (!best.has(x.id) || String(x.at ?? '') >= String(best.get(x.id).at ?? ''))) best.set(x.id, x);
  return [...best.values()].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? ''))).slice(-200);
}
export const merge = (main, run) => (Array.isArray(main) || Array.isArray(run) ? mergeList(Array.isArray(main) ? main : [], Array.isArray(run) ? run : []) : mergeMap(main ?? {}, run ?? {}));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const read = (f) => {
    try {
      return JSON.parse(readFileSync(f, 'utf8'));
    } catch {
      return null;
    }
  };
  const [mainFile, runFile] = process.argv.slice(2);
  const out = merge(read(mainFile), read(runFile));
  writeFileSync(runFile, JSON.stringify(out));
  console.log(`상태 합침 ${path.basename(runFile)} ${Array.isArray(out) ? out.length : Object.keys(out).length}`);
}
