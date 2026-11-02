// 그림 자동 검사(기획안 v7 C5). 매일 작업(daily.mjs)이 올리기 전에 부른다.
//   흰 바탕   : 가장자리 10% 띠에서 밝기 ≥ 245 화소 비율 ≥ 0.90
//   색 수     : 64단계로 줄인 색 가운데 상위 4색이 차지하는 비율 ≥ 0.90 (평면 색 몇 개로 된 그림인지)
//   선        : 검정(밝기 < 60) 화소 비율 0.015 ~ 0.12 (선이 없거나 시커먼 그림 거르기. FLUX.2 klein 은 선이 가늘어 0.019 도 나옴)
//   글자      : Windows 내장 OCR(scripts/winocr.ps1)로 읽은 글자·숫자 수 1 이하(기호 제외) — OCR 이 없는 PC 면 건너뜀(null)
// 사용: node scripts/imgcheck.mjs a.png b.png …  → 줄마다 결과 JSON
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const LIMITS = { edgeWhite: 0.9, top4: 0.9, blackMin: 0.015, blackMax: 0.12 };
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 화소 통계 3개(빠름, 순수 계산) */
export async function pixelStats(buf) {
  const { data, info } = await sharp(buf).removeAlpha().resize(256, 192, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const ex = Math.round(w * 0.1);
  const ey = Math.round(h * 0.1);
  let edge = 0, edgeWhite = 0, black = 0;
  const bins = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (x < ex || x >= w - ex || y < ey || y >= h - ey) {
        edge++;
        if (lum >= 245) edgeWhite++;
      }
      if (lum < 60) black++;
      const k = ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6); // 채널당 4단계 = 64색
      bins.set(k, (bins.get(k) ?? 0) + 1);
    }
  }
  const n = w * h;
  const top4 = [...bins.values()].sort((a, b) => b - a).slice(0, 4).reduce((s, v) => s + v, 0) / n;
  return { edgeWhite: +(edgeWhite / edge).toFixed(3), top4: +top4.toFixed(3), black: +(black / n).toFixed(3) };
}

/**
 * 틀(테두리) 검사 — AI 없이 화소로(2026-11-02 G6). 그림 가장자리 가까이(바깥 15% 띠)에 한 변 길이의 70% 이상을 덮는 어두운 직선이
 * 네 변 중 3변 이상이면 틀. 한 변만 긴 선(바닥 선)은 틀이 아니다. 가운데(40~60%)의 긴 세로선은 두 칸 그림의 칸막이로 따로 센다(틀에 안 셈).
 * → {edges: 0~4, divider: boolean}
 */
export async function frameStats(buf, { cover = 0.7, dark = 110 } = {}) {
  const w = 256, h = 192;
  const { data } = await sharp(buf).removeAlpha().resize(w, h, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const isDark = (x, y) => data[y * w + x] < dark;
  // 한 줄(행 y 또는 열 x)이 어두운 비율. 선이 한 화소 흔들리는 걸 봐주려고 옆줄까지 합친다. 구석 5% 는 뺀다
  const mx = Math.round(w * 0.05), my = Math.round(h * 0.05);
  const rowCover = (y) => {
    let n = 0, t = 0;
    for (let x = mx; x < w - mx; x++) {
      t++;
      if (isDark(x, y) || (y > 0 && isDark(x, y - 1)) || (y < h - 1 && isDark(x, y + 1))) n++;
    }
    return n / t;
  };
  const colCover = (x) => {
    let n = 0, t = 0;
    for (let y = my; y < h - my; y++) {
      t++;
      if (isDark(x, y) || (x > 0 && isDark(x - 1, y)) || (x < w - 1 && isDark(x + 1, y))) n++;
    }
    return n / t;
  };
  const bx = Math.round(w * 0.15), by = Math.round(h * 0.15);
  const best = (from, to, f) => {
    let m = 0;
    for (let i = from; i < to; i++) m = Math.max(m, f(i));
    return m;
  };
  const sides = [best(0, by, rowCover), best(h - by, h, rowCover), best(0, bx, colCover), best(w - bx, w, colCover)];
  const edges = sides.filter((c) => c >= cover).length;
  const divider = best(Math.round(w * 0.4), Math.round(w * 0.6), colCover) >= cover;
  return { edges, divider };
}

/** Windows OCR 로 읽은 글자(공백 뺀) 수. 실패하면 null */
export function ocrChars(files) {
  if (process.platform !== 'win32' || !files.length) return files.map(() => null);
  const dir = mkdtempSync(path.join(tmpdir(), 'wocr-'));
  try {
    const list = path.join(dir, 'list.json');
    writeFileSync(list, JSON.stringify(files.map((f) => path.resolve(f))));
    const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'winocr.ps1'), '-List', list], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    const texts = JSON.parse(out.replace(/^﻿/, '').trim());
    // 글자·숫자만 센다 — ? ! 같은 기호는 추상어 그림에 허용(2026-10-14 장면 규칙)
    return files.map((_, i) => (typeof texts[i] === 'string' ? texts[i].replace(/[^\p{L}\p{N}]/gu, '').length : null));
  } catch {
    return files.map(() => null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 판정: 이유 목록이 비면 통과 */
export function verdict(s, chars, frame = null) {
  const why = [];
  if (s.edgeWhite < LIMITS.edgeWhite) why.push(`edge_white ${s.edgeWhite}`);
  if (s.top4 < LIMITS.top4) why.push(`colors ${s.top4}`);
  if (s.black < LIMITS.blackMin || s.black > LIMITS.blackMax) why.push(`black ${s.black}`);
  // 한 글자는 봐준다 — 그려 넣은 ? ! 를 OCR 이 I·l·1·2 로 읽는 일이 있다
  if (chars > 1) why.push(`text ${chars}`);
  // 틀(G6): 3변 이상에 긴 어두운 선. 두 칸 그림의 가운데 칸막이는 frameStats 가 따로 세어 여기 안 걸린다
  if (frame && frame.edges >= 3) why.push(`frame ${frame.edges}`);
  return why;
}

/** 파일 하나 검사(OCR 포함) */
export async function checkFile(file, buf) {
  const s = await pixelStats(buf);
  const [chars] = ocrChars([file]);
  const frame = await frameStats(buf);
  const why = verdict(s, chars, frame);
  return { ...s, chars, frame: frame.edges, ok: why.length === 0, why };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  const chars = ocrChars(files);
  for (const [i, f] of files.entries()) {
    const { readFileSync } = await import('node:fs');
    const s = await pixelStats(readFileSync(f));
    const frame = await frameStats(readFileSync(f));
    const why = verdict(s, chars[i], frame);
    console.log(JSON.stringify({ file: path.basename(f), ...s, chars: chars[i], frame: frame.edges, divider: frame.divider, ok: why.length === 0, why }));
  }
}
