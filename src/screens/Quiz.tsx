// 퀴즈 한 문제 화면들 — 세션(Session.tsx)과 연습(Practice.tsx)이 같이 쓴다.
// 답하면 onAnswer(맞힘 여부, 단어 id, { 걸린 시간, 힌트 }) → 결과 줄(O · / X 정답 …) → 「다음」.
// 세션은 걸린 시간 · 힌트로 FSRS 채점을 정하고(session.ts autoGrade), 연습은 맞힘 여부만 적는다.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '../k/index.tsx'
import type { DeckItem, PoolWord } from '../../shared/api.ts'
import { checkWrite, withArticle, type Choice, type ChoiceQ, type MatchQ, type WriteQ } from '../practice.ts'
import { T } from '../text.ts'
import { Example, Lemma, LevelBadge, POS_LABEL } from '../ui.tsx'
import './session.css'

export interface AnswerMeta {
  /** 문제가 뜬 뒤 답할 때까지(ms). 짝 맞추기는 앞 짝을 맞춘 뒤부터 */
  ms: number
  hint: boolean
}
type ViewProps<Q> = { q: Q; onAnswer: (correct: boolean, id: string, meta: AnswerMeta) => void; onNext: () => void }

/** 바텀시트 · 창이 열려 있으면 뒤 화면 단축키를 쓰지 않는다 */
export const modalOpen = () => !!document.querySelector('dialog[open], [aria-modal="true"]')

/** 문제가 뜬 시각(첫 렌더) */
function useStartTime() {
  const [t0] = useState(() => performance.now())
  return () => Math.round(performance.now() - t0)
}

/** 문제 꼴 이름(빈칸 · 뜻 · 짝 · 쓰기 · 관사) */
export function QuizTag({ children }: { children: ReactNode }) {
  return <p className="q-tag">{children}</p>
}

/** 답한 뒤 다음 단추 + Enter */
export function NextButton({ onNext }: { onNext: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.repeat && !modalOpen()) {
        e.preventDefault()
        onNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNext])
  return (
    <div className="q-next">
      <Button fullWidth size="large" onClick={onNext} autoFocus>
        {T.next}
      </Button>
    </div>
  )
}

/** 결과 줄: 「O · die Erfahrung = 경험」 / 「X 정답 die Erfahrung = 경험」. 낭독은 맞힘 · 틀림 */
export function Verdict({ ok, word }: { ok: boolean; word: Pick<PoolWord, 'lemma' | 'pos' | 'gender' | 'gloss_ko'> }) {
  return (
    <p className={'q-verdict ' + (ok ? 'ok' : 'ng')} role="status">
      <span className="sr-only">{ok ? T.srO : T.srX} · </span>
      <b aria-hidden>{ok ? T.verdictO : T.verdictX}</b> {ok && <span aria-hidden>· </span>}
      <Lemma word={word} /> {word.gloss_ko && <span className="q-verdict-gl">= {word.gloss_ko}</span>}
    </p>
  )
}

/** 보기 단어 한 줄: 관사 붙인 독일어 · 품사 · 뜻 */
export function WordLine({ w, tag }: { w: PoolWord; tag?: string }) {
  return (
    <p className="pline">
      {tag && <span className="ptag">{tag}</span>}
      <Lemma word={w} /> <span className="small muted">{POS_LABEL[w.pos]}</span> <span>{w.gloss_ko}</span>
    </p>
  )
}

/** 힌트 단추(한 문제에 한 번) */
function HintButton({ used, onUse, disabled }: { used: boolean; onUse: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="q-hint" disabled={used || disabled} aria-pressed={used} onClick={onUse}>
      {T.hint}
    </button>
  )
}

/** 4지선다(빈칸 · 뜻 고르기 · 독일어 고르기). 힌트 = 오답 둘을 지운다 */
export function ChoiceView({ q, onAnswer, onNext }: ViewProps<ChoiceQ>) {
  const [picked, setPicked] = useState<string | null>(null)
  const [hint, setHint] = useState(false)
  const elapsed = useStartTime()
  const w = q.item.word
  // 힌트로 지울 오답: 보기 차례대로 앞의 둘(보기가 이미 섞여 있음)
  const cut = hint ? new Set(q.choices.filter((c) => c.id !== w.id).slice(0, 2).map((c) => c.id)) : new Set<string>()
  const pick = (id: string) => {
    if (picked || cut.has(id)) return
    setPicked(id)
    onAnswer(id === w.id, w.id, { ms: elapsed(), hint })
  }
  // 키보드 1 2 3 4
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/⌘+숫자 = 브라우저 탭 바꾸기 — 보기로 먹지 않게
      if (e.ctrlKey || e.metaKey || e.altKey || modalOpen()) return
      const k = Number(e.key)
      if (k >= 1 && k <= q.choices.length) pick(q.choices[k - 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const state = (id: string) => (!picked ? (cut.has(id) ? ' cut' : '') : id === w.id ? ' ok' : id === picked ? ' ng' : ' off')
  // 답한 뒤 보기마다 아래에 작게: 뜻 고르기 = 그 뜻의 독일어, 나머지 = 그 단어의 뜻
  const sub = (c: Choice) => (q.mode === 'meaning' ? withArticle(c.word) : c.word.gloss_ko)
  const wrongPick = picked && picked !== w.id ? q.choices.find((c) => c.id === picked) : undefined
  return (
    <>
      <div className="pcard">
        <div className="q-head">
          <QuizTag>{q.mode === 'cloze' ? T.blank : '뜻'}</QuizTag>
          <HintButton used={hint} disabled={!!picked} onUse={() => setHint(true)} />
        </div>
        {q.mode === 'cloze' && q.cloze ? (
          <>
            <p className="pde" lang="de">
              {q.cloze.before}
              {picked ? <mark className="hit">{q.cloze.hit}</mark> : <span className="blank" role="img" aria-label={T.blank} />}
              {q.cloze.after}
            </p>
            <p className="small muted">{w.example_ko}</p>
          </>
        ) : q.mode === 'meaning' ? (
          <>
            <p className="pword">
              <Lemma word={w} />
            </p>
            <p className="small muted center">
              {POS_LABEL[w.pos]} <LevelBadge level={w.level} />
            </p>
          </>
        ) : (
          <>
            <p className="pword ko">{w.gloss_ko}</p>
            <p className="small muted center">{POS_LABEL[w.pos]}</p>
          </>
        )}
      </div>
      <div className={'popts' + (q.mode === 'meaning_rev' ? ' two' : '')} role="group" aria-label="보기">
        {q.choices.map((c, k) => (
          <button
            key={c.id}
            type="button"
            className={'popt' + state(c.id)}
            lang={q.mode === 'meaning' ? undefined : 'de'}
            aria-keyshortcuts={String(k + 1)}
            disabled={!!picked || cut.has(c.id)}
            onClick={() => pick(c.id)}
          >
            {c.text}
            {picked && c.id === w.id && <span className="sr-only"> · 정답</span>}
            {picked && c.id === picked && c.id !== w.id && <span className="sr-only"> · 고른 답, 오답</span>}
            {picked && sub(c) && (
              <small className="popt-sub" lang={q.mode === 'meaning' ? 'de' : 'ko'}>
                {sub(c)}
              </small>
            )}
          </button>
        ))}
      </div>
      {picked ? (
        <>
          <Verdict ok={picked === w.id} word={w} />
          {(wrongPick || q.mode !== 'cloze' || (q.cloze && q.cloze.hit.toLowerCase() !== w.lemma.replace(/^sich\s+/i, '').toLowerCase())) && (
            <div className="pgloss">
              {q.mode === 'cloze'
                ? q.cloze &&
                  q.cloze.hit.toLowerCase() !== w.lemma.replace(/^sich\s+/i, '').toLowerCase() && (
                    <p className="small muted">
                      {T.exampleForm} <span lang="de">{q.cloze.hit}</span>
                    </p>
                  )
                : w.example_de && (
                    <>
                      <p className="small" lang="de">
                        <Example de={w.example_de} lemma={w.lemma} hit={w.example_hit} />
                      </p>
                      {w.example_ko && <p className="small muted">{w.example_ko}</p>}
                    </>
                  )}
              {/* 고른 오답 단어 설명(2026-10-27 사용자 지시) */}
              {wrongPick && <WordLine w={wrongPick.word} tag={T.pickedTag} />}
            </div>
          )}
          <NextButton onNext={onNext} />
        </>
      ) : (
        <p className="keys">{T.keysChoice}</p>
      )}
    </>
  )
}

/** 쓰기: 뜻을 보고 직접 입력. 움라우트·ß는 풀어 써도 맞음(ä→ae, ß→ss). 힌트 = 첫 글자 */
export function WriteView({ q, onAnswer, onNext }: ViewProps<WriteQ>) {
  const [value, setValue] = useState('')
  const [done, setDone] = useState<boolean | null>(null)
  const [hint, setHint] = useState(false)
  const elapsed = useStartTime()
  const w = q.item.word
  const head = w.lemma.replace(/^sich\s+/i, '').charAt(0)
  const check = () => {
    if (done !== null || !value.trim()) return
    const ok = checkWrite(q.item, value)
    setDone(ok)
    onAnswer(ok, w.id, { ms: elapsed(), hint })
  }
  return (
    <>
      <div className="pcard">
        <div className="q-head">
          <QuizTag>쓰기</QuizTag>
          <HintButton used={hint} disabled={done !== null} onUse={() => setHint(true)} />
        </div>
        <p className="pword ko">{w.gloss_ko}</p>
        <p className="small muted center">
          {POS_LABEL[w.pos]} <LevelBadge level={w.level} />
          {hint && (
            <>
              {' · '}
              <span lang="de" className="q-hint-text">
                {head}…
              </span>
            </>
          )}
        </p>
      </div>
      <div className="pwrite">
        <input
          type="text"
          lang="de"
          className="k-input"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={hint ? `${head}…` : T.writePlaceholder}
          value={value}
          readOnly={done !== null}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              // 확인 Enter 가 그대로 window 로 올라가 방금 뜬 NextButton 의 Enter 까지 건드리지 않게 끊고, 답한 뒤 Enter 는 여기서 바로 다음으로
              e.stopPropagation()
              if (done === null) check()
              else if (!e.repeat) onNext()
            }
          }}
          autoFocus
          aria-label={T.writeLabel}
        />
        {done === null ? (
          <Button fullWidth size="large" onClick={check} disabled={!value.trim()}>
            {T.check}
          </Button>
        ) : (
          <>
            <Verdict ok={done} word={w} />
            {w.example_de && (
              <div className="pgloss">
                <p className="small" lang="de">
                  <Example de={w.example_de} lemma={w.lemma} hit={w.example_hit} />
                </p>
                {w.example_ko && <p className="small muted">{w.example_ko}</p>}
              </div>
            )}
            <NextButton onNext={onNext} />
          </>
        )}
      </div>
      {done === null && <p className="keys">{T.keysWrite}</p>}
    </>
  )
}

/**
 * 짝 맞추기: 왼쪽(독일어) 하나 + 오른쪽(뜻) 하나를 차례로 누른다(어느 쪽 먼저든). 맞으면 둘 다 잠기고,
 * 틀리면 잠깐 빨갛게 보였다가 풀린다 — 먼저 누른 쪽 단어를 「틀림」으로 남긴다(그 단어를 찾다가 헷갈린 것).
 * 단어마다 짝을 맞출 때 결과 하나(한 번이라도 틀렸으면 틀림). 걸린 시간 = 앞 짝을 맞춘 뒤부터
 */
export function MatchView({ q, onAnswer, onNext }: ViewProps<MatchQ>) {
  const [sel, setSel] = useState<{ side: 'l' | 'r'; id: string } | null>(null)
  const [done, setDone] = useState<string[]>([])
  const [missed, setMissed] = useState<string[]>([])
  const [bad, setBad] = useState<{ l: string; r: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastAt = useRef(performance.now())
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  const finished = done.length === q.items.length
  const [said, setSaid] = useState('')

  const tap = (side: 'l' | 'r', c: Choice) => {
    if (done.includes(c.id) || bad) return
    if (!sel || sel.side === side) {
      setSel(sel && sel.side === side && sel.id === c.id ? null : { side, id: c.id })
      return
    }
    const l = side === 'l' ? c.id : sel.id
    const r = side === 'r' ? c.id : sel.id
    if (l === r) {
      const t = performance.now()
      setDone((d) => [...d, l])
      onAnswer(!missed.includes(l), l, { ms: Math.round(t - lastAt.current), hint: false })
      lastAt.current = t
      setSaid(`${T.srO}. ${q.left.find((x) => x.id === l)?.text} = ${q.right.find((x) => x.id === l)?.text}`)
      setSel(null)
      return
    }
    // 먼저 누른 쪽 단어를 틀림으로(그 단어 짝을 찾던 중)
    setMissed((m) => (m.includes(sel.id) ? m : [...m, sel.id]))
    setBad({ l, r })
    setSaid(T.matchWrong)
    setSel(null)
    timer.current = setTimeout(() => setBad(null), 650)
  }
  const cls = (side: 'l' | 'r', id: string) =>
    done.includes(id) ? ' ok' : bad && bad[side] === id ? ' ng' : sel && sel.side === side && sel.id === id ? ' sel' : ''
  const col = (side: 'l' | 'r', list: Choice[]) => (
    <div className="pmatch-col" role="group" aria-label={side === 'l' ? '독일어' : '뜻'}>
      {list.map((c) => (
        <button
          key={c.id}
          type="button"
          className={'popt pm' + cls(side, c.id)}
          lang={side === 'l' ? 'de' : undefined}
          aria-pressed={sel?.side === side && sel.id === c.id}
          disabled={done.includes(c.id)}
          onClick={() => tap(side, c)}
        >
          {c.text}
        </button>
      ))}
    </div>
  )
  return (
    <>
      <QuizTag>짝</QuizTag>
      <div className="pmatch">
        {col('l', q.left)}
        {col('r', q.right)}
      </div>
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
      {finished ? (
        <>
          <div className="pgloss">
            {q.items.map((it) => (
              <WordLine key={it.word.id} w={it.word} tag={missed.includes(it.word.id) ? T.wrongTag : undefined} />
            ))}
          </div>
          <NextButton onNext={onNext} />
        </>
      ) : (
        <p className="small muted center">{T.matchHint}</p>
      )}
    </>
  )
}

const ARTS = ['der', 'die', 'das'] as const
type Art = (typeof ARTS)[number]

/** 관사 고르기(긴 간격 복습의 명사). 뜻은 답한 뒤에. 힌트 = 오답 하나를 지운다 */
export function ArtikelView({ item, onAnswer, onNext }: { item: DeckItem; onAnswer: ViewProps<null>['onAnswer']; onNext: () => void }) {
  const w = item.word
  const [picked, setPicked] = useState<Art | null>(null)
  const [hint, setHint] = useState(false)
  const elapsed = useStartTime()
  const cut = hint ? ARTS.find((a) => a !== w.gender) : undefined
  const pick = (a: Art) => {
    if (picked || a === cut) return
    setPicked(a)
    onAnswer(a === w.gender, w.id, { ms: elapsed(), hint })
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || modalOpen()) return
      const k = Number(e.key)
      if (k >= 1 && k <= 3) pick(ARTS[k - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <>
      <div className="pcard">
        <div className="q-head">
          <QuizTag>관사</QuizTag>
          <HintButton used={hint} disabled={!!picked} onUse={() => setHint(true)} />
        </div>
        <p className="pword" lang="de">
          <span className={'q-art' + (picked ? ' g-' + w.gender : '')}>{picked ? w.gender : '___'}</span> {w.lemma}
        </p>
        <p className="small muted center">{picked ? w.gloss_ko : POS_LABEL[w.pos]}</p>
      </div>
      <div className="q-arts" role="group" aria-label="관사">
        {ARTS.map((a, k) => (
          <button
            key={a}
            type="button"
            lang="de"
            className={'popt q-art-btn g-' + a + (picked ? (a === w.gender ? ' ok' : a === picked ? ' ng' : ' off') : a === cut ? ' cut' : '')}
            disabled={!!picked || a === cut}
            aria-keyshortcuts={String(k + 1)}
            onClick={() => pick(a)}
          >
            {a}
          </button>
        ))}
      </div>
      {picked ? (
        <>
          <Verdict ok={picked === w.gender} word={w} />
          <NextButton onNext={onNext} />
        </>
      ) : (
        <p className="keys">{T.keysArtikel}</p>
      )}
    </>
  )
}
