// 오늘 화면(기획 v11 5절): 「오늘 몫 · N분」 카드 하나(단계 칩 + 「시작」) → 기사 카드 자리 → 「+10개 · 연습 ›」 한 줄.
// 오늘 몫 = 오늘 학습일(04:00 경계)이 끝나기 전에 마감되는 복습 + 아침에 정한 새 단어 — 세션은 #/session 에서 한 번에.
import { useCallback, useEffect, useState } from 'react'
import { BottomSheet, Button, Card, Chip, ProgressBar, SegmentedControl, SegmentedControlItem, Skeleton } from '../k/index.tsx'
import { IconChevronLeft, IconChevronRight } from '../k/icons.tsx'
import type { PracticeMode, Settings, TodayResponse } from '../../shared/api.ts'
import { api, errorText } from '../api.ts'
import { fmtDay } from '../format.ts'
import { useAsync } from '../hooks.ts'
import { MODES } from '../practice.ts'
import { navigate, useRoute } from '../router.ts'
import { EXPR_PER_DAY, minutesFor, todayCounts } from '../session.ts'
import { MODE_NAME, T } from '../text.ts'
import { CountUp, ErrorBox, Top, useToaster } from '../ui.tsx'
import { articleApi } from '../articles.ts'
import { statusText } from './Read.tsx'
import './read.css'
import './today.css'

export default function Today({ onSettings }: { onSettings: (p: Partial<Settings>) => Promise<void> }) {
  // 알림의 빈칸 문제 링크(?first=)는 세션으로 바로
  const first = useRoute().query.get('first')
  useEffect(() => {
    if (first) navigate(`/session?first=${encodeURIComponent(first)}`, true)
  }, [first])
  // 세션으로 바로 갈 거면 여기서 받지 않는다(미리 받은 오늘 몫은 세션이 쓴다)
  const today = useAsync(() => (first ? new Promise<TodayResponse>(() => {}) : api.today()), [])
  const [sheet, setSheet] = useState(false)
  const closeSheet = useCallback(() => setSheet(false), [])
  const d = today.data
  return (
    <>
      <Top title={T.today} actions />
      <main className="page td">
        {d ? (
          <PlanCard key={d.date} d={d} onSettings={onSettings} onChanged={today.reload} />
        ) : today.error ? (
          <ErrorBox error={today.error} onRetry={today.reload} />
        ) : (
          <Skeleton variant="rectangle" width="100%" height={184} radius={12} />
        )}
        <ArticleSlot />
        <div className="td-more">
          <Button size="large" variant="outlined" color="primary" onClick={() => navigate('/session?more=1')}>
            {T.more10}
          </Button>
          <Button size="large" variant="outlined" color="assistive" onClick={() => setSheet(true)}>
            {T.practice} <IconChevronRight size={18} aria-hidden />
          </Button>
        </div>
      </main>
      <PracticeSheet open={sheet} studiedToday={(d?.plan.done ?? 0) > 0} onClose={closeSheet} />
    </>
  )
}

/** 오늘의 기사 카드 + 표현 복습(v11 4단계). 기사가 없으면(평일 11시 전 첫 주 등) 아무것도 안 그린다 */
function ArticleSlot() {
  const [t, setT] = useState<Awaited<ReturnType<typeof articleApi.today>> | null>(null)
  const [due, setDue] = useState(0)
  useEffect(() => {
    let live = true
    articleApi.today().then((x) => live && setT(x), () => undefined)
    articleApi.exprDue(10).then((x) => live && setDue(x.items.length), () => undefined)
    return () => {
      live = false
    }
  }, [])
  const a = t?.article
  return (
    <>
      {a ? (
        <Card className="td-article">
          <p className="rd-cap">{t?.is_today ? '오늘의 기사' : '지난 평일 기사'}{a.category ? ` · ${a.category}` : ''}</p>
          <p className="rd-title" lang="de">{a.title}</p>
          <p className="rd-sub">{a.words}단어 · 약 {Math.max(2, Math.round(a.words / 35))}분 · {statusText(a)}</p>
          <Button fullWidth size="large" variant={a.status === 'done' ? 'outlined' : 'solid'} color="primary" onClick={() => navigate(`/article/${a.id}`)}>
            {a.status === 'done' ? '다시 보기' : a.status === 'opened' ? '이어 읽기' : '읽기'}
          </Button>
        </Card>
      ) : null}
      {due ? (
        <button type="button" className="rd-row" onClick={() => navigate('/expressions')}>
          <span>
            <b>표현 복습 {due >= 10 ? '10개+' : `${due}개`}</b>
            <small>기사에서 저장한 표현</small>
          </span>
          <IconChevronRight />
        </button>
      ) : null}
    </>
  )
}

function PlanCard({ d, onSettings, onChanged }: { d: TodayResponse; onSettings: (p: Partial<Settings>) => Promise<void>; onChanged: () => void }) {
  const toast = useToaster()
  const [busy, setBusy] = useState(false)
  const left = d.due.length + d.fresh.length
  const { total, done, extra, extra_max } = d.plan
  const reviewOnly = d.settings.review_only_day === d.date
  const away = d.settings.vacation_until && d.settings.vacation_until >= d.date ? d.settings.vacation_until : ''
  const c = todayCounts(d)
  // 오늘 몫 끝에 이어 보는 저장한 표현 수(세션과 같은 하루 3개)
  const [exprN, setExprN] = useState(0)
  useEffect(() => {
    let live = true
    articleApi.exprDue(EXPR_PER_DAY).then((x) => live && setExprN(x.items.length), () => undefined)
    return () => {
      live = false
    }
  }, [])

  // 복습만(B6): 이 학습일만 새 카드 0. 다음 학습일엔 저절로 풀린다
  const setReviewOnly = async (on: boolean) => {
    await onSettings({ review_only_day: on ? d.date : '' })
    onChanged()
  }
  // 새 단어 +5(D3): 오늘 목록 뒤에 5개. 하루 상한까지
  const more = async () => {
    setBusy(true)
    try {
      const t = await api.todayMore()
      if (t.plan.extra === extra) toast(T.newPlusNone, 'cautionary')
      onChanged()
    } catch (e) {
      toast(`${T.newPlusFail} · ${errorText(e)}`, 'negative')
    } finally {
      setBusy(false)
    }
  }
  const reviewOnlyChip = (d.fresh.length > 0 || reviewOnly) && (
    <Chip className="td-ro" active={reviewOnly} aria-pressed={reviewOnly} onClick={() => setReviewOnly(!reviewOnly)}>
      {T.reviewOnly}
    </Chip>
  )
  const awayNote = away && <p className="small muted">{T.away(fmtDay(away))}</p>

  // 남은 카드가 있음 → 시작 · 이어서
  if (left > 0) {
    return (
      <Card className="td-plan" aria-label={T.plan}>
        <div className="td-head">
          <h1>{T.planMin(minutesFor(left))}</h1>
          {reviewOnlyChip}
        </div>
        <ul className="td-steps" aria-label="단계">
          {c.review > 0 && (
            <li>
              {T.stepReview} <b className="num">{c.review}</b>
            </li>
          )}
          {c.fresh > 0 && (
            <li>
              {T.stepNew} <b className="num">{c.fresh}</b>
            </li>
          )}
          {c.quiz > 0 && (
            <li>
              {T.stepQuiz} <b className="num">{c.quiz}</b>
            </li>
          )}
          {exprN > 0 && (
            <li>
              표현 <b className="num">{exprN}</b>
            </li>
          )}
        </ul>
        {done > 0 && (
          <div className="td-prog">
            <ProgressBar value={done / Math.max(1, total)} label={`${T.plan} ${total}장 중 ${done}장 끝`} />
            <span className="small num">
              {done} / {total}
            </span>
          </div>
        )}
        {awayNote}
        <Button fullWidth size="large" onClick={() => navigate('/session')}>
          {done > 0 ? T.resume : T.start}
        </Button>
      </Card>
    )
  }

  // 오늘 몫 끝(또는 처음부터 없음) → O · X · 내일 복습 · 새 단어 +5
  const ended = total > 0
  return (
    <Card className="td-plan" aria-label={T.plan}>
      <div className="td-head">
        <h1>{ended ? T.planDone : T.planEmpty}</h1>
        {!ended && reviewOnlyChip}
      </div>
      {ended ? (
        <p className="td-ox">
          <span className="o">
            {T.o} <b className="num">{d.ratings.good}</b>
          </span>
          <span className="x">
            {T.x} <b className="num">{d.ratings.again}</b>
          </span>
          <span className="small muted">
            <Tomorrow />
          </span>
        </p>
      ) : (
        <p className="small">{reviewOnly ? T.planEmptyReviewOnly : T.planEmptyDesc}</p>
      )}
      {awayNote}
      {exprN > 0 && (
        // 카드는 끝났어도 오늘 표현 복습이 남았으면 세션으로(카드가 없으면 표현부터)
        <Button fullWidth size="large" onClick={() => navigate('/session')}>
          표현 복습 {exprN}개
        </Button>
      )}
      {reviewOnly ? (
        <Button fullWidth variant="outlined" color="primary" onClick={() => setReviewOnly(false)}>
          {T.reviewOnly} · 끄기
        </Button>
      ) : (
        extra < extra_max && (
          <>
            <Button fullWidth variant="outlined" color="primary" loading={busy} onClick={more}>
              {T.newPlus}
            </Button>
            <p className="small muted center">{T.newPlusNote(extra, extra_max)}</p>
          </>
        )
      )}
    </Card>
  )
}

/** 내일 복습 수(오늘 몫을 끝냈을 때만 부른다) */
function Tomorrow() {
  const st = useAsync(() => api.stats(), [])
  return <>{T.tomorrow('')}{st.data ? <CountUp value={st.data.due_tomorrow} /> : <span className="num">…</span>}</>
}

/** 연습 목록(6절: 빈칸 · 짝 · 뜻 · 쓰기 · 관사 · 넘겨 보기). 방식을 늘리면 여기 한 줄(문제 꼴은 practice.ts · Quiz.tsx) */
interface Entry {
  key: keyof typeof MODE_NAME
  desc: string
  mode?: PracticeMode
}
const ENTRIES: Entry[] = [
  { key: 'mix', desc: '카드에 맞는 문제를 섞어서(오늘 몫과 같은 방식) · 끝 화면 「+10개」와 같아요' },
  { key: 'cloze', desc: MODES.cloze.desc, mode: 'cloze' },
  { key: 'match', desc: MODES.match.desc, mode: 'match' },
  { key: 'meaning', desc: '독일어 → 뜻, 뜻 → 독일어', mode: 'meaning' },
  { key: 'write', desc: MODES.write.desc, mode: 'write' },
  { key: 'artikel', desc: 'der · die · das 1분' },
  { key: 'swipe', desc: '배운 카드를 넘기며 뜻 확인' },
]
const SCOPES: Array<[string, string]> = [
  ['today', T.scopeToday],
  ['week', T.scopeWeek],
  ['all', T.scopeAll],
  ['wrong', T.scopeWrong],
]

/** 「연습 ›」 바텀시트: 목록 → (범위 × 분량 · 뜻은 방향) → 시작. 관사는 바로 */
function PracticeSheet({ open, studiedToday, onClose }: { open: boolean; studiedToday: boolean; onClose: () => void }) {
  const [entry, setEntry] = useState<Entry | null>(null)
  const [scope, setScope] = useState('today')
  const [n, setN] = useState('10')
  const [dir, setDir] = useState<'meaning' | 'meaning_rev'>('meaning')
  const swipe = entry?.key === 'swipe'
  // 고정 함수: BottomSheet 가 onClose 가 바뀔 때마다 시트에 초점을 다시 옮긴다
  const close = useCallback(() => {
    setEntry(null)
    onClose()
  }, [onClose])
  const pick = (e: Entry) => {
    if (e.key === 'artikel') {
      close()
      navigate('/artikel')
      return
    }
    // 오늘 아직 안 했으면 「최근 7일」부터
    setScope(studiedToday ? 'today' : 'week')
    setN('10')
    setEntry(e)
  }
  const start = () => {
    if (!entry) return
    const path = swipe
      ? `/drill?scope=${scope}&n=${n}`
      : entry.key === 'mix'
        ? `/session?more=1&scope=${scope}&n=${n}`
        : `/practice?mode=${entry.mode === 'meaning' ? dir : entry.mode}&scope=${scope}&n=${n}`
    close()
    navigate(path)
  }
  const scopes = swipe ? SCOPES.slice(0, 3) : SCOPES
  const sizes = swipe ? ['10', '30', '50'] : ['10', '20', '30']
  return (
    <BottomSheet open={open} onClose={close} title={entry ? MODE_NAME[entry.key] : T.practiceTitle}>
      {!entry ? (
        <ul className="td-modes">
          {ENTRIES.map((e) => (
            <li key={e.key}>
              <button type="button" className="td-mode" onClick={() => pick(e)}>
                <b>{MODE_NAME[e.key]}</b>
                <span className="small muted">{e.desc}</span>
                <IconChevronRight className="td-chev" size={20} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="td-opts">
          <p className="small muted">{entry.desc}</p>
          {entry.mode === 'meaning' && (
            <>
              <p className="td-l">{T.dirLabel}</p>
              <SegmentedControl size="small" value={dir} onValueChange={(v) => setDir(v as typeof dir)}>
                <SegmentedControlItem value="meaning">{T.dirMeaning}</SegmentedControlItem>
                <SegmentedControlItem value="meaning_rev">{T.dirRev}</SegmentedControlItem>
              </SegmentedControl>
            </>
          )}
          <p className="td-l">{T.scopeLabel}</p>
          <div className="td-scopes" role="radiogroup" aria-label={T.scopeLabel}>
            {scopes.map(([v, l]) => (
              <Chip key={v} role="radio" aria-checked={scope === v} active={scope === v} onClick={() => setScope(v)}>
                {l}
              </Chip>
            ))}
          </div>
          <p className="td-l">{T.sizeLabel}</p>
          <SegmentedControl size="small" value={n} onValueChange={setN}>
            {sizes.map((v) => (
              <SegmentedControlItem key={v} value={v}>
                {v}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <p className="small muted">{swipe ? T.swipeNote : T.practiceNote}</p>
          <div className="td-act">
            <Button variant="outlined" color="assistive" leadingContent={<IconChevronLeft size={18} aria-hidden />} onClick={() => setEntry(null)}>
              {T.practiceBack}
            </Button>
            <Button onClick={start}>{T.start}</Button>
          </div>
        </div>
      )}
    </BottomSheet>
  )
}
