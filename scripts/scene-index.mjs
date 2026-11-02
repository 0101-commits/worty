// 겹치는 장면 검사(G5a)의 색인 .data/scenes.json 을 처음 채운다 — 최신 백업의 로컬 사본(scripts/db/local-copy.mjs)에서 읽는다(원격 전체 읽기 없음).
// 이후에는 daily.mjs 가 장면을 쓸 때마다 이 파일에 더한다. 사용: node scripts/scene-index.mjs seed
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENES_FILE, readJsonFile, stripPin, writeJsonFile } from './scene.mjs';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === 'seed') {
  const { openLocalDb } = await import('./db/local-copy.mjs');
  const db = openLocalDb();
  const rows = db.prepare('SELECT id, scene_en FROM words WHERE scene_en IS NOT NULL').all();
  const idx = readJsonFile(SCENES_FILE, {});
  for (const r of rows) idx[r.id] = stripPin(r.scene_en);
  writeJsonFile(SCENES_FILE, idx);
  console.log(`장면 색인 ${Object.keys(idx).length}개 → ${SCENES_FILE}`);
}
