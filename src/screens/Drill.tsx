// 넘겨 보기(오늘 › 연습 · 단어 목록 「10개 연습」): 배운 카드를 넘기며 뜻 확인.
// 한 판 안에서만 돈다 — X 는 줄 뒤로, O 는 빼기. 서버에 채점을 보내지 않아 일정(FSRS)은 그대로(D5, G17).
import { parseWordsParams } from '../wordsFilter.ts'
import { useReducer, useState } from 'react'
import { Button, Skeleton } from '../k/index.tsx'
import type { DeckItem, DrillScope, WordsQuery } from '../../shared/api.ts'
import { api } from '../api.ts'
import { deckReducer, initDeck, shuffle } from '../deck.ts'
import { useAsync } from '../hooks.ts'
import { navigate, useRoute } from '../router.ts'
import { SwipeDeck } from '../SwipeDeck.tsx'
import { MODE_NAME, T } from '../text.ts'
import { Emoji, ErrorBox, Top } from '../ui.tsx'
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
        <p className="small muted center">일정은 바뀌지 않았어요. 복습 날짜는 오늘 몫 그대로예요.</p>
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
