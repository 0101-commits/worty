// 긴 독일어 낱말 줄바꿈(v13 U1). 지금까지는 body 의 overflow-wrap: anywhere 때문에 아무 글자에서나 끊겼다
// (Geschwindigkeitsbeschränk|ung). 보이지 않는 끊김 표시(U+00AD, 줄이 넘어갈 때만 「-」가 보임)를
// 합성어 경계(L4 풀이 자료)에, 없으면 음절 경계에 넣는다. 브라우저 자동 하이픈(hyphens:auto)은 엔진마다 달라 쓰지 않는다.
// 그리는 순간에만 쓴다 — 소리(TTS) · 빈칸 · 찾기 · 채점 · DB 에는 원래 lemma 를 그대로.
export const SHY = '­'

/** 이보다 짧은 덩어리는 카드 칸에 늘 들어가 끊지 않는다 */
export const MIN_SPLIT = 10
/** 끊은 앞·뒤 조각 최소 글자 수(한두 글자가 줄 끝·처음에 홀로 남지 않게) */
const EDGE = 3

const VOWELS = 'aeiouyäöüAEIOUYÄÖÜ'
/** 한 소리라 가운데서 안 끊는 자음 묶음(긴 것부터) */
const UNITS = ['sch', 'ch', 'ck', 'ph', 'th', 'qu']

/** 음절 첫소리로 올 수 있는 자음 묶음(다음 음절로 통째 넘김 — Ge-schwin · be-trug · ver-schrei · bungs-pflich) */
const ONSETS = new Set(
  'sch schl schm schn schr schw st str sp spr spl pf pfl pfr bl br dr fl fr gl gr kl kn kr pl pr tr zw qu ch chr ck ph phr th thr wr'.split(' '),
)

/**
 * 음절 경계 찾기(어림 규칙): 모음 사이 자음 묶음에서 다음 음절 첫소리로 올 수 있는 가장 긴 꼬리를 넘긴다
 * (없으면 마지막 자음 하나). ch · ck · sch · ph · th · qu 는 한 자음. 모음끼리는 끊지 않는다(ei · ie · au …).
 * 사전과 다른 자리도 있지만(Au-sei-nan-der) 줄 끝에서만 보이고, 글자 중간 아무 데서나 끊던 것보다 낫다.
 * 돌려주는 값 = 끊어도 되는 글자 위치(그 앞에서 끊음)
 */
export function syllableBreaks(word: string): number[] {
  // 나누기: 모음 한 글자 · 자음 묶음 단위 · 그 밖(하이픈 · 숫자)
  const units: Array<{ at: number; s: string; kind: 'v' | 'c' | 'x' }> = []
  for (let i = 0; i < word.length; ) {
    const ch = word[i]
    if (VOWELS.includes(ch)) {
      units.push({ at: i, s: ch, kind: 'v' })
      i++
    } else if (!/\p{L}/u.test(ch)) {
      units.push({ at: i, s: ch, kind: 'x' })
      i++
    } else {
      const low = word.slice(i).toLowerCase()
      const u = UNITS.find((x) => low.startsWith(x)) ?? low[0]
      units.push({ at: i, s: u, kind: 'c' })
      i += u.length
    }
  }
  const out: number[] = []
  for (let k = 0; k < units.length; k++) {
    if (units[k].kind !== 'v') continue
    // 모음(묶음) 끝 → 자음 묶음 → 다음 모음 꼴만
    let a = k
    while (a + 1 < units.length && units[a + 1].kind === 'v') a++
    let b = a + 1
    while (b < units.length && units[b].kind === 'c') b++
    if (b >= units.length || units[b].kind !== 'v' || b === a + 1) {
      k = a
      continue
    }
    const cons = units.slice(a + 1, b)
    let cut = cons.length - 1
    for (let m = 0; m < cons.length; m++) {
      if (ONSETS.has(cons.slice(m).map((u) => u.s.toLowerCase()).join(''))) {
        cut = m
        break
      }
    }
    // 이음 s(Rechts|anwalt · Lebens|abschnitt · …ungs|amt): t·g·k·n 뒤 s 에 모음이 이어지면 s 뒤에서 끊는다
    const lo = cons.map((u) => u.s.toLowerCase())
    const fugenS = lo.length >= 2 && lo[lo.length - 1] === 's' && ['t', 'g', 'k', 'n'].includes(lo[lo.length - 2])
    const at = fugenS ? units[b].at : cons[cut].at
    if (at >= EDGE && word.length - at >= EDGE) out.push(at)
    k = a
  }
  return out
}

/** 위치들에 끊김 표시 넣기 */
function insertAt(word: string, at: number[]): string {
  let s = ''
  let last = 0
  for (const i of [...new Set(at)].sort((a, b) => a - b)) {
    if (i <= last || i >= word.length) continue
    s += word.slice(last, i) + SHY
    last = i
  }
  return s + word.slice(last)
}

/**
 * 합성어 풀이 조각(L4)의 경계 위치. 조각을 이어 붙인 것이 낱말과 같을 때만(대소문자 무시) — 아니면 빈 배열.
 * 이음 글자(-s- · -n-)는 앞 조각에 붙여 「Geschwindigkeits-|beschränkung」처럼 끊는다.
 */
export function partBreaks(word: string, parts: Array<{ p: string; link?: boolean }> | null | undefined): number[] {
  if (!parts?.length) return []
  if (parts.map((x) => x.p).join('').toLowerCase() !== word.toLowerCase()) return []
  const out: number[] = []
  let pos = 0
  parts.forEach((x, i) => {
    pos += x.p.length
    const nextLink = parts[i + 1]?.link
    if (i < parts.length - 1 && !nextLink && !x.link) out.push(pos)
    else if (x.link && i < parts.length - 1) out.push(pos)
  })
  return out.filter((at) => at >= EDGE && word.length - at >= EDGE)
}

/**
 * 띄어쓰기로 나뉜 덩어리마다 끊김 표시. mode = parts(합성어 경계만, 풀이가 없으면 음절) · syllables(합성어 + 음절)
 * MIN_SPLIT 보다 짧은 덩어리는 그대로.
 */
export function hyphenate(text: string, parts?: Array<{ p: string; link?: boolean }> | null, mode: 'parts' | 'syllables' = 'parts'): string {
  return text
    .split(/(\s+)/)
    .map((tok) => {
      if (/^\s+$/.test(tok) || tok.length < MIN_SPLIT) return tok
      const pb = partBreaks(tok, parts)
      if (pb.length && mode === 'parts') return insertAt(tok, pb)
      return insertAt(tok, [...pb, ...syllableBreaks(tok)])
    })
    .join('')
}

/** 한 줄에서 안 끊기는 조각들(끊김 표시 · 띄어쓰기 기준) — 글씨 크기 맞출 때 가장 넓은 조각을 잰다 */
export function pieces(hyphenated: string): string[] {
  return hyphenated.split(/[\s­]+/).filter(Boolean)
}
