// 연습 화면(오늘 › 연습): #/practice?mode=cloze|match|meaning|meaning_rev|write&scope=today|week|all|wrong&n=10
// 한 문제씩 → O · / X 정답 …(고른 보기의 뜻도) → 다음. 끝나면 결과를 practice 표에 보내고,
// 틀린 배운 단어는 서버가 「다시」 채점해 오늘 몫 복습에 다시 넣는다. 틀린 단어만 다시 할 수도 있다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, ProgressBar, Skeleton } from '../k/index.tsx'
import type { DeckItem, PoolWord, PracticeMode, PracticeScope } from '../../shared/api.ts'
import { api, errorText } from '../api.ts'
import { MODES, makeQuestions, wordsIn } from '../practice.ts'
import { useAsync } from '../hooks.ts'
import { linkTo, navigate, useRoute } from '../router.ts'
import { T } from '../text.ts'
import { Emoji, ErrorBox, Lemma, Top, useToaster } from '../ui.tsx'
import { ChoiceView, MatchView, WriteView } from './Quiz.tsx'
import './session.css'

const MODE_KEYS = Object.keys(MODES) as PracticeMode[]
const SCOPES: PracticeScope[] = ['today', 'week', 'all', 'wrong']
const SCOPE_EMPTY: Record<PracticeScope, string> = {
  today: '오늘 본 단어가 아직 없어요. 오늘 몫을 먼저 하거나 범위를 넓혀 보세요.',
  week: '최근 7일에 본 단어가 없어요.',
  all: '아직 배운 단어가 없어요.',
  wrong: '틀린 단어가 없어요. 다 맞혔거나 아직 연습 전이에요.',
}

export default function Practice() {
  const q = useRoute().query
  // 예전 「예문 속 단어 짚기」(pick) 주소는 짝 맞추기로
  const mode = q.get('mode') === 'pick' ? 'match' : (MODE_KEYS.find((m) => m === q.get('mode')) ?? 'cloze')
  const scope = SCOPES.find((s) => s === q.get('scope')) ?? 'today'
  const n = [10, 20, 30].includes(Number(q.get('n'))) ? Number(q.get('n')) : 10
  const [round, setRound] = useState(0)
  const r = useAsync(() => api.practice(scope, n), [scope, n, round])
  return (
    <>
      <Top title={MODES[mode].title} back="/today" />
      <main className="page practice-page">
        {r.error ? (
          <ErrorBox error={r.error} onRetry={r.reload} />
        ) : !r.data || r.loading ? (
          <Skeleton variant="rectangle" width="100%" height={360} radius={16} />
        ) : (
          <Round key={`${mode}:${scope}:${n}:${round}`} mode={mode} items={r.data.items} pool={r.data.pool} n={n} scope={scope} onAgain={() => setRound((k) => k + 1)} />
        )}
      </main>
    </>
  )
}

interface Result {
  word_id: string
  correct: boolean
  at: string
}

function Round(props: { mode: PracticeMode; items: DeckItem[]; pool: PoolWord[]; n: number; scope: PracticeScope; onAgain: () => void }) {
  const { mode, pool, n, scope, onAgain } = props
  const toast = useToaster()
  // 「틀린 단어만 다시」는 같은 재료에서 틀린 카드만으로 새 판
  const [items, setItems] = useState(props.items)
  const [pass, setPass] = useState(0)
  const questions = useMemo(() => makeQuestions(mode, items, pool, n), [mode, items, pool, n, pass])
  const total = useMemo(() => questions.reduce((s, qq) => s + wordsIn(qq), 0), [questions])
  const [i, setI] = useState(0)
  const [results, setResults] = useState<Result[]>([])
  // 서버가 「아직 잘 모르는 단어」로 바꾼 단어(판 끝 전송의 답). null = 아직 모름 · 전송 실패
  const [relearn, setRelearn] = useState<string[] | null>(null)

  const finished = i >= questions.length
  // 결과 보내기: 판이 끝날 때 + 중간에 앱을 내리거나 나갈 때(그때까지 푼 것만, 검토 반영). 실패해도 화면은 그대로 — 기록만 빠짐
  const latest = useRef<Result[]>([])
  const sent = useRef(0)
  useEffect(() => {
    latest.current = results
  }, [results])
  const flush = useCallback(
    (keepalive: boolean) => {
      const rs = latest.current.slice(sent.current)
      if (!rs.length) return
      sent.current = latest.current.length
      api
        .savePractice({ mode, results: rs }, keepalive)
        .then((r) => {
          if (!keepalive) setRelearn((prev) => [...(prev ?? []), ...(r.relearn ?? [])])
        })
        .catch((e) => {
          if (!keepalive) toast(T.saveFail(errorText(e)), 'cautionary')
        })
    },
    [mode, toast],
  )
  useEffect(() => {
    if (finished) flush(false)
  }, [finished, flush])
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush(true)
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      flush(true)
    }
  }, [flush])

  const answer = useCallback((correct: boolean, id: string) => {
    setResults((rs) => [...rs, { word_id: id, correct, at: new Date().toISOString() }])
  }, [])

  if (questions.length === 0)
    return (
      <section className="empty">
        <Emoji name="think" size={140} />
        <h2>퀴즈를 만들 단어가 없어요</h2>
        <p>{mode === 'match' && props.items.length > 0 ? '짝은 뜻이 서로 다른 단어가 3개 이상 있어야 해요. 범위를 넓혀 보세요.' : SCOPE_EMPTY[scope]}</p>
        <Button variant="outlined" color="assistive" onClick={() => navigate('/today')}>
          {T.backToday}
        </Button>
      </section>
    )

  if (finished) {
    const right = results.filter((x) => x.correct).length
    const wrongIds = new Set(results.filter((x) => !x.correct).map((x) => x.word_id))
    const all = questions.flatMap((qq) => (qq.mode === 'match' ? qq.items : [qq.item]))
    const wrong = all.filter((it) => wrongIds.has(it.word.id))
    const moved = relearn?.length ?? 0
    return (
      <section className="ss-end practice-done">
        <Emoji name={wrong.length ? 'study' : 'happy'} size={104} />
        <p className="ss-ox" data-testid="practice-result" aria-label={`${T.srO} ${right} · ${T.srX} ${results.length - right}`}>
          <span className="o">
            {T.o} <b className="num">{right}</b>
          </span>
          <span className="x">
            {T.x} <b className="num">{results.length - right}</b>
          </span>
        </p>
        {wrong.length > 0 ? (
          <div className="pgloss">
            <p className="small muted">
              틀린 단어 {wrong.length}
              {/* 0 이면 말 안 함 — 이미 오늘 몫인 단어이거나, 앱을 내리며 보낸 묶음의 답은 못 받는다(검토 반영) */}
              {moved > 0 ? ` · ${moved}개를 오늘 복습에 넣었어요` : ''}
            </p>
            {wrong.map((it) => (
              <a key={it.word.id} className="kv" {...linkTo('/word/' + it.word.id)}>
                <Lemma word={it.word} />
                <span className="small muted">{it.word.gloss_ko}</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="small muted center">하나도 안 틀렸어요</p>
        )}
        {moved > 0 && (
          <Button fullWidth size="large" onClick={() => navigate('/session')}>
            오늘 복습에서 다시 보기
          </Button>
        )}
        {wrong.length > 0 && (
          <Button
            fullWidth
            size="large"
            variant={moved > 0 ? 'outlined' : 'solid'}
            color={moved > 0 ? 'assistive' : 'primary'}
            onClick={() => {
              setItems(wrong)
              setPass((p) => p + 1)
              setI(0)
              setResults([])
              setRelearn(null)
              latest.current = []
              sent.current = 0
            }}
          >
            틀린 단어만 다시
          </Button>
        )}
        <Button fullWidth size="large" variant={wrong.length ? 'outlined' : 'solid'} color={wrong.length ? 'assistive' : 'primary'} onClick={onAgain}>
          한 판 더
        </Button>
        <Button fullWidth size="large" variant="outlined" color="assistive" onClick={() => navigate('/today')}>
          {T.backToday}
        </Button>
      </section>
    )
  }

  const qq = questions[i]
  const before = questions.slice(0, i).reduce((s, x) => s + wordsIn(x), 0)
  return (
    <>
      <div className="q-top">
        <ProgressBar value={before / total} label={T.progress} />
        <span className="ss-count num" data-testid="progress" aria-live="polite">
          {mode === 'match' ? `${before + wordsIn(qq)} / ${total}` : `${i + 1} / ${questions.length}`}
        </span>
      </div>
      {qq.mode === 'match' ? (
        <MatchView key={`${pass}:${i}`} q={qq} onAnswer={answer} onNext={() => setI((k) => k + 1)} />
      ) : qq.mode === 'write' ? (
        <WriteView key={`${pass}:${i}`} q={qq} onAnswer={answer} onNext={() => setI((k) => k + 1)} />
      ) : (
        <ChoiceView key={`${pass}:${i}`} q={qq} onAnswer={answer} onNext={() => setI((k) => k + 1)} />
      )}
    </>
  )
}
