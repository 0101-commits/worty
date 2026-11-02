// 오늘 몫 한 세션(기획 v11 5절): #/session — 진행 막대 하나, 카드 상태에 맞는 연습을 섞어 낸다(session.ts planStep).
// 채점은 쌓았다가 판 끝(또는 앱을 내릴 때) 한 번에 보낸다(sendReviews — 못 보내면 기기에 적어 두고 다음에 열 때 다시).
// 「+10개」(#/session?more=1)는 배운 단어 10개로 같은 세션을 돌리고 결과는 연습 기록(/api/practice)에 적는다 — 틀린 단어는 서버가 「다시」로.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { BottomSheet, Button, IconButton, OxBar, ProgressBar, Skeleton, TextField } from '../k/index.tsx'
import { IconClose, IconFlipBackward, IconMore } from '../k/icons.tsx'
import type { DeckItem, PoolWord, PracticeMode, PracticeResultsRequest, Rating } from '../../shared/api.ts'
import { api, errorText, sendReviews } from '../api.ts'
import { articleApi, type SavedExpr } from '../articles.ts'
import { speak } from '../tts.ts'
import { deckReducer, initDeck } from '../deck.ts'
import { useAsync } from '../hooks.ts'
import { linkTo, navigate, useRoute } from '../router.ts'
import { EXPR_PER_DAY, MORE_N, autoGrade, limitFor, mergePool, orderToday, oxCount, planStep, practiceMode, type Kind, type Step } from '../session.ts'
import { CardFace, SwipeDeck } from '../SwipeDeck.tsx'
import { T } from '../text.ts'
import { Emoji, ErrorBox, useToaster } from '../ui.tsx'
import { ArtikelView, ChoiceView, MatchView, WriteView, type AnswerMeta } from './Quiz.tsx'
import './session.css'

interface Loaded {
  mode: 'today' | 'more'
  /** 처음 줄 */
  queue: DeckItem[]
  pool: PoolWord[]
  /** 오늘 학습일 끝(오늘 몫만). 채점 뒤 이보다 앞에 다시 볼 카드는 같은 판 뒤로 */
  dayEnd: string | null
  key: string
  /** 오늘 몫 끝에 이어 볼 저장한 표현(하루 EXPR_PER_DAY 개, +10개에는 없음) */
  exprs: SavedExpr[]
}

async function loadToday(first: string | null): Promise<Loaded> {
  // 보기(오답) 재료는 연습 재료 요청에 딸려 온다. 못 받으면 오늘 카드 단어로만
  const [t, p, e] = await Promise.all([
    api.today(),
    api.practice('all', 1).catch(() => null),
    articleApi.exprDue(EXPR_PER_DAY).catch(() => ({ items: [] as SavedExpr[] })),
  ])
  const queue = orderToday(t, first)
  return { mode: 'today', queue, pool: mergePool(p?.pool ?? [], queue), dayEnd: t.day_end, key: t.date + t.settings.review_only_day + (first ?? ''), exprs: e.items }
}

async function loadMore(): Promise<Loaded> {
  const usable = (items: DeckItem[]) => items.filter((it) => it.word.gloss_ko)
  let r = await api.practice('week', MORE_N)
  if (usable(r.items).length < 4) r = await api.practice('all', MORE_N)
  const queue = usable(r.items).slice(0, MORE_N)
  return { mode: 'more', queue, pool: mergePool(r.pool, queue), dayEnd: null, key: 'more' + Date.now(), exprs: [] }
}

export default function Session() {
  const q = useRoute().query
  const more = q.get('more') === '1'
  const first = q.get('first')
  const [round, setRound] = useState(0)
  const data = useAsync(() => (more ? loadMore() : loadToday(first)), [more, first, round])
  if (data.data && !data.loading) return <Run key={data.data.key} d={data.data} onMore={() => (more ? setRound((n) => n + 1) : navigate('/session?more=1'))} />
  return (
    <div className="ss">
      <SessionHead value={0} count="" />
      <main className="page ss-page">
        {data.error ? (
          <ErrorBox error={data.error} onRetry={data.reload} />
        ) : (
          <>
            <Skeleton variant="rectangle" width="100%" height={268} radius={16} />
            <Skeleton variant="text" width="50%" height={28} />
          </>
        )}
      </main>
    </div>
  )
}

function SessionHead({ value, count, onUndo, onMenu }: { value: number; count: string; onUndo?: () => void; onMenu?: () => void }) {
  return (
    <header className="ss-head">
      <IconButton aria-label={T.sessionClose} onClick={() => navigate('/today')}>
        <IconClose />
      </IconButton>
      <ProgressBar value={value} label={T.progress} />
      <span className="ss-count num" data-testid="progress" aria-live="polite">
        {count}
      </span>
      {onUndo && (
        <IconButton aria-label={T.undo} onClick={onUndo}>
          <IconFlipBackward />
        </IconButton>
      )}
      {onMenu && (
        <IconButton aria-label={T.menu} onClick={onMenu}>
          <IconMore />
        </IconButton>
      )}
    </header>
  )
}

/** 지금 단계에서 답한 결과(「다음」을 누르면 줄에 반영) */
interface Answered {
  kind: Kind
  grades: Array<{ word_id: string; rating: Rating; at: string }>
}

function Run({ d, onMore }: { d: Loaded; onMore: () => void }) {
  const toast = useToaster()
  const today = d.mode === 'today'
  // 오늘 몫: 「다시」만 판 뒤로 + 오늘 학습일 안에 다시 볼 카드는 판 뒤로(F2). +10개: 판 뒤로 안 보냄(한 번씩)
  const [s, dispatch] = useReducer(deckReducer, d, (x) => initDeck(x.queue, today ? 1 : (0 as Rating), x.dayEnd))
  const [sid] = useState(() => Date.now().toString(36) + Math.random().toString(36).slice(2, 8))
  const [lastKind, setLastKind] = useState<Kind | null>(null)
  const [undoable, setUndoable] = useState(false)
  const [menu, setMenu] = useState(false)
  const closeMenu = useCallback(() => setMenu(false), [])
  const [skipped, setSkipped] = useState(0)
  // 카드 줄이 끝나면 저장한 표현을 이어서(같은 진행 막대). ei = 지금 표현 차례, eox = 표현 O·X
  const [ei, setEi] = useState(0)
  const [eox, setEox] = useState({ o: 0, x: 0 })
  const total = s.queue.length + d.exprs.length
  const answered = useRef<Answered | null>(null)
  // +10개: 채점 하나(단어|시각) → 퀴즈 꼴(연습 기록 방식)
  const kinds = useRef(new Map<string, Kind>())

  const step = useMemo(
    () => planStep(s.queue, s.index, { pool: d.pool, seen: s.reshows, lastKind, practice: !today }),
    // 줄 · 자리가 바뀔 때만 새로 정한다(보기 섞기가 다시 그릴 때마다 바뀌지 않게). lastKind 는 채점과 같은 때 바뀐다
    [s.queue, s.index],
  )

  // 보내기: 아직 안 보낸 채점만. 이벤트 처리기에서 최신 상태를 읽으려고 ref 에 둔다.
  const latest = useRef(s)
  useEffect(() => {
    latest.current = s
  }, [s])
  const flush = useCallback(
    (keepalive: boolean): Promise<unknown> | null => {
      const st = latest.current
      const list = st.pending.slice(st.sentCount)
      if (!list.length) return null
      latest.current = { ...st, sentCount: st.pending.length }
      dispatch({ type: 'flush' })
      if (today) return sendReviews({ session_id: sid, reviews: list }, keepalive)
      const byMode = new Map<PracticeMode, PracticeResultsRequest['results']>()
      for (const r of list) {
        const k = kinds.current.get(`${r.word_id}|${r.reviewed_at}`)
        const m = k ? practiceMode(k) : null
        if (!m) continue
        byMode.set(m, [...(byMode.get(m) ?? []), { word_id: r.word_id, correct: r.rating >= 2, at: r.reviewed_at }])
      }
      return Promise.all([...byMode].map(([mode, results]) => api.savePractice({ mode, results }, keepalive)))
    },
    [sid, today],
  )

  // 판 끝 → 한 번 전송(끝 화면은 바로). 실패해도 채점은 기기에 남아 다음에 열 때 다시 보낸다
  useEffect(() => {
    if (!s.finished) return
    flush(false)?.catch((e) => toast((today ? T.sendFail : T.saveFail)(errorText(e)), 'negative'))
  }, [s.finished, flush, toast, today])

  // 앱을 내리거나 다른 화면으로 가면 그때까지의 채점을 보낸다
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush(true)?.catch(() => undefined)
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      flush(false)?.catch(() => undefined)
    }
  }, [flush])

  // 답 하나 적기(퀴즈). 짝 맞추기는 단어마다 한 번씩 불린다
  const record = (kind: Kind, word_id: string, rating: Rating) => {
    const at = new Date().toISOString()
    answered.current = { kind, grades: [...(answered.current?.grades ?? []), { word_id, rating, at }] }
  }
  const onAnswer = (kind: Kind) => (correct: boolean, id: string, meta: AnswerMeta) => record(kind, id, autoGrade({ correct, ...meta }, limitFor(kind)))
  // 「다음」: 답한 결과를 줄에 반영(카드마다 채점 하나)
  const advance = () => {
    const a = answered.current
    answered.current = null
    if (!a?.grades.length) return
    for (const g of a.grades) kinds.current.set(`${g.word_id}|${g.at}`, a.kind)
    if (a.grades.length === 1) dispatch({ type: 'grade', rating: a.grades[0].rating, at: a.grades[0].at })
    else dispatch({ type: 'gradeMany', grades: a.grades }) // 짝은 맞춘 차례로 적힌다 — 리듀서가 줄 차례로 놓는다
    setLastKind(a.kind)
    setUndoable(false)
  }
  // 카드 뒤집기: X · O 를 누르거나 밀면 바로 채점
  const gradeFlip = (rating: Rating) => {
    const at = new Date().toISOString()
    kinds.current.set(`${s.queue[s.index]?.word.id}|${at}`, 'flip')
    answered.current = null
    dispatch({ type: 'grade', rating, at })
    setLastKind('flip')
    setUndoable(today) // 보내기 전까지 1단계(+10개는 연습 기록이라 안 함)
  }
  const undo = () => {
    answered.current = null
    dispatch({ type: 'undo' })
    setUndoable(false)
  }
  const skip = () => {
    answered.current = null
    setMenu(false)
    dispatch({ type: 'skip' })
    setSkipped((n) => n + 1)
    setUndoable(false)
  }

  if (s.finished && ei < d.exprs.length) {
    const gradeExpr = (rating: 1 | 3) => {
      articleApi.gradeExpr(d.exprs[ei].id, rating).catch((e) => toast(T.sendFail(errorText(e)), 'negative'))
      setEox((v) => (rating === 1 ? { ...v, x: v.x + 1 } : { ...v, o: v.o + 1 }))
      setEi((n) => n + 1)
    }
    return (
      <div className="ss">
        <SessionHead value={(s.queue.length + ei) / Math.max(1, total)} count={`${s.queue.length + ei + 1} / ${total}`} />
        <main className="page ss-page" data-step="expr">
          <ExprStep key={d.exprs[ei].id} x={d.exprs[ei]} onGrade={gradeExpr} />
        </main>
      </div>
    )
  }

  if (s.finished) {
    const c = oxCount(s.pending)
    const ox = { o: c.o + eox.o, x: c.x + eox.x }
    return (
      <div className="ss">
        <SessionHead value={1} count="" />
        <main className="page ss-page">
          <section className="ss-end">
            <Emoji name={ox.x <= ox.o / 4 ? 'happy' : 'study'} size={104} />
            <h1>{total === 0 ? (today ? T.planEmpty : T.moreEmpty) : today ? T.planDone : T.sessionMore}</h1>
            {s.pending.length + eox.o + eox.x > 0 && (
              <p className="ss-ox" aria-label={`${T.srO} ${ox.o} · ${T.srX} ${ox.x}`}>
                <span className="o">
                  {T.o} <b className="num">{ox.o}</b>
                </span>
                <span className="x">
                  {T.x} <b className="num">{ox.x}</b>
                </span>
              </p>
            )}
            {skipped > 0 && today && <p className="small muted center">{T.sessionLeft(skipped)}</p>}
            <Button fullWidth size="large" onClick={onMore}>
              {T.more10}
            </Button>
            <div className="ss-end-links">
              <a className="ss-link" {...linkTo('/stats')}>
                {T.record} ›
              </a>
              <a className="ss-link" {...linkTo('/today')}>
                {T.backToday}
              </a>
            </div>
          </section>
        </main>
      </div>
    )
  }

  if (!step) return null
  const item = step.items[0]
  const stepKey = `${s.index}|${s.pending.length}|${skipped}`
  const single = step.items.length === 1
  return (
    <div className="ss">
      <SessionHead
        value={s.index / Math.max(1, total)}
        count={`${s.index + 1} / ${total}`}
        onUndo={undoable && s.history ? undo : undefined}
        onMenu={single ? () => setMenu(true) : undefined}
      />
      <main className={'page ss-page' + (step.kind === 'flip' ? ' ss-flip' : '')} data-step={step.kind}>
        {step.kind === 'flip' ? (
          <SwipeDeck key={stepKey} cards={[{ key: stepKey, item }]} onGrade={gradeFlip} onUndo={undoable ? undo : undefined} />
        ) : (
          <StepView key={stepKey} step={step} onAnswer={onAnswer(step.kind)} onNext={advance} />
        )}
      </main>
      <MoreMenu open={menu} item={item} onClose={closeMenu} onSkip={skip} />
    </div>
  )
}

/** 저장한 표현: 뜻 보고 떠올리기 → 「표현 보기」 → X · O (X = 다시, O = 좋음) */
function ExprStep({ x, onGrade }: { x: SavedExpr; onGrade: (rating: 1 | 3) => void }) {
  const [shown, setShown] = useState(false)
  return (
    <>
      <section className="ss-expr" data-testid="expr">
        <p className="cap">저장한 표현 · 뜻을 보고 떠올려 보세요</p>
        <p className="mean">{x.meaning_ko}</p>
        {shown ? (
          <>
            <p className="base" lang="de">{x.base}</p>
            {x.sentence ? <p className="sent" lang="de">{x.sentence}</p> : null}
          </>
        ) : null}
      </section>
      <div className="ss-bar">
        <div className="ss-bar-in">
          {shown ? (
            <OxBar onX={() => onGrade(1)} onO={() => onGrade(3)} />
          ) : (
            <Button fullWidth size="large" onClick={() => {
              setShown(true)
              speak(x.base)
            }}>
              표현 보기
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

/** 소개 카드(새 단어 · 잊은 단어) → 퀴즈. 소개 카드는 채점하지 않는다 */
function StepView({ step, onAnswer, onNext }: { step: Step; onAnswer: (correct: boolean, id: string, meta: AnswerMeta) => void; onNext: () => void }) {
  const [intro, setIntro] = useState(step.intro)
  if (intro) return <Intro item={step.items[0]} onDone={() => setIntro(false)} />
  const q = step.q
  if (step.kind === 'artikel') return <ArtikelView item={step.items[0]} onAnswer={onAnswer} onNext={onNext} />
  if (q?.mode === 'match') return <MatchView q={q} onAnswer={onAnswer} onNext={onNext} />
  if (q?.mode === 'write') return <WriteView q={q} onAnswer={onAnswer} onNext={onNext} />
  if (q) return <ChoiceView q={q} onAnswer={onAnswer} onNext={onNext} />
  return null
}

/** 소개 카드: 그림 · 단어 · 뜻 · 예문(단어 강조) · 번역 → 「다음」(Enter) */
function Intro({ item, onDone }: { item: DeckItem; onDone: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && !document.querySelector('[aria-modal="true"]')) {
        e.preventDefault()
        onDone()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])
  return (
    <>
      <div className="fc intro" data-testid="intro">
        <CardFace item={item} back />
      </div>
      <div className="ss-bar">
        <div className="ss-bar-in">
          <Button fullWidth size="large" onClick={onDone} autoFocus>
            {T.next}
          </Button>
        </div>
      </div>
    </>
  )
}

/** 「⋯」: 그림 이상 · 뜻 수정 · 넘기기(예전 「이상해요」 자리). 알림은 다음 새벽 검토가 맨 먼저 본다 */
function MoreMenu({ open, item, onClose, onSkip }: { open: boolean; item: DeckItem | undefined; onClose: () => void; onSkip: () => void }) {
  const toast = useToaster()
  const [form, setForm] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const close = useCallback(() => {
    setForm(false)
    setNote('')
    onClose()
  }, [onClose])
  if (!item) return null
  const send = async (kind: 'image' | 'meaning') => {
    setBusy(true)
    try {
      await api.report(item.word.id, { kind, ...(note.trim() ? { note: note.trim() } : {}) })
      close()
      toast(T.reportThanks, 'positive')
    } catch (e) {
      toast(T.reportFail(errorText(e)), 'negative')
    } finally {
      setBusy(false)
    }
  }
  return (
    <BottomSheet open={open} onClose={close} title={<span lang="de">{item.word.lemma}</span>}>
      {form ? (
        <div className="ss-menu-form">
          <TextField placeholder={T.menuNote} aria-label={T.menuNote} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          <div className="ss-menu-act">
            <Button variant="outlined" color="assistive" onClick={() => setForm(false)}>
              {T.close}
            </Button>
            <Button loading={busy} onClick={() => send('meaning')}>
              {T.menuSend}
            </Button>
          </div>
        </div>
      ) : (
        <ul className="ss-menu">
          <li>
            <button type="button" disabled={busy} onClick={() => send('image')}>
              {T.menuImage}
            </button>
          </li>
          <li>
            <button type="button" onClick={() => setForm(true)}>
              {T.menuMeaning}
            </button>
          </li>
          <li>
            <button type="button" onClick={onSkip}>
              {T.menuSkip}
            </button>
          </li>
        </ul>
      )}
    </BottomSheet>
  )
}
