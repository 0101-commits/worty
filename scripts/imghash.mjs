// 그림 지각 해시(dHash, 2026-11-02 G5b) — 같거나 거의 같은 그림이 다른 단어에 올라가는 걸 막는다.
// 17×16 회색으로 줄여 이웃 화소 밝기 비교 → 256비트(16진 64글자). 해시는 .data/dhash.json({단어 id: 해시})에 둔다(daily.yml 이 main 에 되올림).
// 사용: node scripts/imghash.mjs seed   — 올라가 있는 그림 전부를 받아 해시 파일을 처음 채운다(손으로 한 번, APP_URL·API_TOKEN 필요)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DATA_DIR, readJsonFile, writeJsonFile } from './scene.mjs';

export const DHASH_FILE = path.join(DATA_DIR, 'dhash.json');
/** 이 거리(다른 비트 수, 256 중) 이하면 같은 그림으로 본다. 하얀 바탕이 많아 너무 크게 잡으면 다른 그림이 걸린다 */
export const DHASH_MAX_DIST = Number(process.env.DHASH_MAX_DIST) || 10;

export async function dhash(buf) {
  const { data } = await sharp(buf).flatten({ background: '#fff' }).resize(17, 16, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) bits += data[y * 17 + x] > data[y * 17 + x + 1] ? '1' : '0';
  let hex = '';
  for (let i = 0; i < 256; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
/** 두 해시의 다른 비트 수 */
export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

/** store = {id: hash}. 다른 단어의 그림 중 거리 ≤ max 인 가장 가까운 것 → {id, dist} | null */
export function nearDuplicate(id, hash, store, max = DHASH_MAX_DIST) {
  let best = null;
  for (const [oid, oh] of Object.entries(store ?? {})) {
    if (oid === id) continue;
    const dist = hamming(hash, oh);
    if (dist <= max && (!best || dist < best.dist)) best = { id: oid, dist };
  }
  return best;
}

export const loadHashes = () => readJsonFile(DHASH_FILE, {});
export const saveHashes = (m) => writeJsonFile(DHASH_FILE, m);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === 'seed') {
  await import('./admin.mjs'); // .env 를 읽는다
  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  const res = await fetch(`${base}/api/admin/images`, { headers: { authorization: `Bearer ${process.env.API_TOKEN}` } });
  const { items } = await res.json();
  const store = loadHashes();
  let n = 0;
  for (const w of items) {
    try {
      const r = await fetch(`${base}/img/${w.id}.webp`);
      if (r.ok) {
        store[w.id] = await dhash(Buffer.from(await r.arrayBuffer()));
        n++;
      }
    } catch { /* 한 장 못 받으면 건너뜀 */ }
  }
  saveHashes(store);
  const ids = Object.keys(store);
  const pairs = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const d = hamming(store[ids[i]], store[ids[j]]);
      if (d <= DHASH_MAX_DIST) pairs.push([ids[i], ids[j], d]);
    }
  }
  console.log(`해시 ${n}장 저장 · 거리 ≤ ${DHASH_MAX_DIST} 쌍 ${pairs.length}: ${JSON.stringify(pairs.slice(0, 40))}`);
}
