// 읽기 탭(v11 4단계): 오늘의 기사 · 한 편 더 · 지난 기사 · 저장한 표현
import { useEffect, useState } from 'react'
import { Button, Card, Skeleton } from '../k/index.tsx'
import { IconChevronRight } from '../k/icons.tsx'
import { articleApi, type Article, type ArticleRow } from '../articles.ts'
import { errorText } from '../api.ts'
import { navigate } from '../router.ts'
import { ErrorBox, Top, useToaster } from '../ui.tsx'
import './read.css'

const minutes = (w: number) => Math.max(2, Math.round(w / 35))
export function statusText(a: Pick<Article, 'status' | 'quiz_score'>) {
  return a.status === 'done' ? `끝 · O ${a.quiz_score ?? 0}` : a.status === 'opened' ? '읽는 중' : '아직 안 읽음'
}

export default function Read() {
  const toast = useToaster()
  const [t, setT] = useState<Awaited<ReturnType<typeof articleApi.today>> | null>(null)
  const [list, setList] = useState<ArticleRow[]>([])
  const [exprN, setExprN] = useState(0)
  const [err, setErr] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [boot, setBoot] = useState(0)

  useEffect(() => {
    let live = true
    setErr(undefined)
    Promise.all([articleApi.today(), articleApi.list(), articleApi.exprs()]).then(
      ([a, b, c]) => {
        if (!live) return
        setT(a)
        setList(b.items.filter((x) => x.id !== a.article?.id))
        setExprN(c.items.length)
      },
      (e) => live && setErr(errorText(e)),
    )
    return () => {
      live = false
    }
  }, [boot])

  const more = async () => {
    setBusy(true)
    try {
      const r = await articleApi.more()
      if (r.article) navigate(`/article/${r.article.id}`)
      else toast(r.reason === 'limit' ? '오늘 「한 편 더」는 다 읽었어요' : '더 읽을 기사가 아직 없어요(17:35 에 더 들어와요)')
    } catch (e) {
      toast(errorText(e), 'negative')
    } finally {
      setBusy(false)
    }
  }

  const a = t?.article
  return (
    <>
      <Top title="읽기" actions />
      <main className="page read-home">
        {err ? <ErrorBox error={err} onRetry={() => setBoot((b) => b + 1)} /> : null}
        {!t && !err ? <Skeleton height={190} radius={12} /> : null}
        {t && !a ? (
          <Card>
            <p className="rd-cap">오늘의 기사</p>
            <p>평일 11시에 KBS 독일어 기사 한 편이 들어와요.</p>
          </Card>
        ) : null}
        {a ? (
          <Card className="rd-today">
            <p className="rd-cap">{t?.is_today ? '오늘의 기사' : `지난 평일 기사 · ${a.day.slice(5).replace('-', '/')}`}{a.category ? ` · ${a.category}` : ''}</p>
            <h2 className="rd-title" lang="de">{a.title}</h2>
            <p className="rd-sub">{a.words}단어 · 약 {minutes(a.words)}분 · {statusText(a)}</p>
            <Button fullWidth size="large" onClick={() => navigate(`/article/${a.id}`)}>
              {a.status === 'done' ? '다시 보기' : a.status === 'opened' ? '이어 읽기' : '읽기'}
            </Button>
            <Button fullWidth size="large" variant="outlined" color="primary" loading={busy} disabled={!t?.more_left} onClick={more}>
              한 편 더{t?.more_left ? ` · ${t.more_left}편 남음` : ''}
            </Button>
          </Card>
        ) : null}

        <button type="button" className="rd-row" onClick={() => navigate('/expressions')}>
          <span>
            <b>저장한 표현</b>
            <small>{exprN}개 · 복습</small>
          </span>
          <IconChevronRight />
        </button>

        {list.length ? <h3 className="rd-h">지난 기사</h3> : null}
        <ul className="rd-list">
          {list.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => navigate(`/article/${x.id}`)}>
                <span className="rd-day">{x.day.slice(5).replace('-', '/')}</span>
                <span className="rd-li">
                  <b lang="de">{x.title}</b>
                  <small>{statusText(x)}{x.saved ? ` · 표현 ${x.saved}` : ''}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </main>
    </>
  )
}
