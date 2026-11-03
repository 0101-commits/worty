// 넘겨 보기(오늘 › 연습 · 단어 목록 「10개 연습」 · 기록 「모아서 연습」): 배운 카드를 넘기며 뜻 확인.
// 한 판 안에서 X 는 줄 뒤로, O 는 빼기. 판이 끝나면(또는 나가면) 결과를 연습 기록(mode flip)으로 보낸다 —
// 틀린 배운 카드는 서버가 「다시」로 내일·모레 복습에 넣는다(2026-11-03, 예전엔 기록 안 함).
import { parseWordsParams } from '../wordsFilter.ts'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Button, Skeleton } from '../k/index.tsx'
import type { DeckItem, DrillScope, WordsQuery } from '../../shared/api.ts'
import { api, errorText } from '../api.ts'
import { deckReducer, initDeck, shuffle } from '../deck.ts'
import { useAsync } from '../hooks.ts'
import { navigate, useRoute } from '../router.ts'
import { SwipeDeck } from '../SwipeDeck.tsx'
import { MODE_NAME, T } from '../text.ts'
import { Emoji, ErrorBox, Top, useToaster } from '../ui.tsx'
import './session.css'

export const SCOPE_LABEL: Record<DrillScope, string> = { today: T.scopeToday, week: T.scopeWeek, all: T.scopeAll }
const SIZES = [10, 30, 50]

/** 주소 → 불러오기. from=words 면 단어 목록과 같은 거르기·정렬 앞에서 n장 */
async function load(q: URLSearchParams): Promise<{ title: string; items: DeckItem[] }> {
  const n = SIZES.includes(Number(q.get('n'))) ? Number(q.get('n')) : 10
  if (q.get('from') === 'words') {
    // 단어 탭 「N개 연습」(v11 3단계): 거르기 조건(품사·그림·자주 틀림·이번 주)을 그대로, 개수는 1~50
    const size = Math.max(1, Math.min(50, Number(q.get('n')) || 10))
    const w: WordsQuery = { ...parseWordsParams(q), page: 1, size, no_total: 1 }
    return { title: '목록', items: (await api.words(w)).items }
  }
  const scope = (['today', 'week', 'all'] as const).find((s) => s === q.get('scope')) ?? 'today'
  return { title: SCOPE_LABEL[scope], items: (await api.drill(scope, n)).items }
}

export default function Drill() {
  const route = useRoute()
  const key = route.query.toString()
  const [round, setRound] = useState(0)
  const r = useAsync(() => load(route.query), [key, round])
  return (
    <>
      <Top title={r.data ? `${MODE_NAME.swipe} · ${r.data.title}` : MODE_NAME.swipe} back="/today" />
      <main className="page ss-page ss-flip">
        {r.error ? (
          <ErrorBox error={r.error} onRetry={r.reload} />
        ) : !r.data || r.loading ? (
          <Skeleton variant="rectangle" width="100%" height={420} radius={16} />
        ) : r.data.items.length === 0 ? (
          <section className="empty">
            <Emoji name="think" size={140} />
            <h2>이 범위에는 아직 배운 단어가 없어요</h2>
            <p>범위를 넓히거나 오늘 몫을 먼저 해 보세요.</p>
            <Button variant="outlined" color="assistive" onClick={() => navigate('/today')}>
              {T.backToday}
            </Button>
          </section>
        ) : (
          <Run key={key + ':' + round} items={r.data.items} onAgain={() => setRound((n) => n + 1)} />
        )}
      </main>
    </>
  )
}

function Run({ items, onAgain }: { items: DeckItem[]; onAgain: () => void }) {
  // X(다시 1)는 줄 뒤로(최대 2번), O(좋음 3)는 빼기
  const [s, dispatch] = useReducer(deckReducer, items, (it) => initDeck(shuffle(it), 2))
  const toast = useToaster()
  // 서버가 「다시」로 바꾼 카드 수(판 끝 전송의 답). null = 아직 모름
  const [moved, setMoved] = useState<number | null>(null)
  const latest = useRef(s)
  useEffect(() => {
    latest.current = s
  }, [s])
  // 보낸 결과 수 — 앱을 내릴 때 보낸 뒤에도 이어서 넘긴 것은 판 끝에 마저 보낸다
  const sent = useRef(0)
  const save = useCallback(
    (keepalive: boolean) => {
      const p = latest.current.pending.slice(sent.current)
      if (!p.length) return
      sent.current = latest.current.pending.length
      dispatch({ type: 'flush' }) // 보낸 채점은 되돌리지 않는다(되돌리기 기록을 비운다)
      // 단어마다 마지막 답만(판 안에서 X 뒤 O 로 고친 단어는 「다시」로 보내지 않는다 — 검토 반영)
      const last = new Map(p.map((r) => [r.word_id, r] as const))
      api
        .savePractice({ mode: 'flip', results: [...last.values()].map((r) => ({ word_id: r.word_id, correct: r.rating >= 2, at: r.reviewed_at })) }, keepalive)
        .then(
          (r) => !keepalive && setMoved((m) => (m ?? 0) + (r.relearn?.length ?? 0)),
          (e) => !keepalive && toast(T.saveFail(errorText(e)), 'cautionary'),
        )
    },
    [toast],
  )
  useEffect(() => {
    if (s.finished) save(false)
  }, [s.finished, save])
  // 판 중간에 나가거나 앱을 내리면 그때까지 넘긴 것만(폰에서 내린 앱은 그대로 꺼질 수 있다 — 검토 반영)
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') save(true)
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      save(true)
    }
  }, [save])
  if (s.finished) {
    const cards = new Set(s.pending.map((p) => p.word_id)).size
    const again = s.pending.filter((p) => p.rating === 1).length
    return (
      <section className="ss-end">
        <Emoji name="party" size={104} />
        <h1>{T.sessionMore}</h1>
        <p className="ss-ox" aria-label={`${cards}장 · ${T.srX} ${again}`}>
          <span className="o">
            <b className="num">{cards}</b>장
          </span>
          <span className="x">
            {T.x} <b className="num">{again}</b>
          </span>
        </p>
        <p className="small muted center">{moved ? `X 한 배운 단어 ${moved}개는 내일·모레 복습에 다시 나와요.` : again ? T.practiceNote : '다 알았어요. 복습 날짜는 그대로예요.'}</p>
        <Button fullWidth size="large" onClick={onAgain}>
          한 판 더
        </Button>
        <Button fullWidth size="large" variant="outlined" color="assistive" onClick={() => navigate('/today')}>
          {T.backToday}
        </Button>
      </section>
    )
  }
  const cards = s.queue.slice(s.index, s.index + 3).map((item, k) => ({ key: String(s.index + k), item }))
  return (
    <>
      <div className="q-top">
        <span className="small muted">{T.swipeNote}</span>
        <span className="ss-count num" data-testid="progress" aria-live="polite">
          {s.index + 1} / {s.queue.length}
        </span>
      </div>
      <SwipeDeck cards={cards} onGrade={(rating) => dispatch({ type: 'grade', rating, at: new Date().toISOString() })} onUndo={() => dispatch({ type: 'undo' })} />
    </>
  )
}
