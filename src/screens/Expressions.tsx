// 저장한 표현(v11 4단계): 목록 · 지우기 · 복습(뜻 보고 표현 떠올리기 → X/O)
import { useEffect, useState } from 'react'
import { Button, Card, OxBar, ProgressBar, Skeleton } from '../k/index.tsx'
import { articleApi, type SavedExpr } from '../articles.ts'
import { errorText } from '../api.ts'
import { ErrorBox, Top, useToaster } from '../ui.tsx'
import './read.css'

export default function Expressions() {
  const toast = useToaster()
  const [items, setItems] = useState<SavedExpr[] | null>(null)
  const [due, setDue] = useState<SavedExpr[]>([])
  const [err, setErr] = useState<string>()
  const [review, setReview] = useState(false)
  const [k, setK] = useState(0)
  const [shown, setShown] = useState(false)
  const [boot, setBoot] = useState(0)

  useEffect(() => {
    Promise.all([articleApi.exprs(), articleApi.exprDue(10)]).then(([a, b]) => {
      setItems(a.items)
      setDue(b.items)
    }, (e) => setErr(errorText(e)))
  }, [boot])

  const grade = async (rating: 1 | 3) => {
    const x = due[k]
    try {
      await articleApi.gradeExpr(x.id, rating)
    } catch (e) {
      toast(errorText(e), 'negative')
    }
    if (k + 1 >= due.length) {
      setReview(false)
      setK(0)
      setBoot((b) => b + 1)
      toast('표현 복습 끝', 'positive')
    } else {
      setK(k + 1)
      setShown(false)
    }
  }
  const del = async (id: number) => {
    try {
      await articleApi.delExpr(id)
      setItems((s) => s?.filter((x) => x.id !== id) ?? null)
    } catch (e) {
      toast(errorText(e), 'negative')
    }
  }

  if (review && due[k])
    return (
      <>
        <Top title="표현 복습" back="/expressions" />
        <main className="page ex-rev">
          <ProgressBar value={k / due.length} label="표현 복습 진행" />
          <Card className="ex-card">
            <p className="rd-cap">뜻을 보고 표현을 떠올려 보세요</p>
            <p className="ex-mean">{due[k].meaning_ko}</p>
            {shown ? (
              <>
                <p className="ex-base" lang="de">{due[k].base}</p>
                {due[k].sentence ? <p className="rd-sub" lang="de">{due[k].sentence}</p> : null}
              </>
            ) : (
              <Button fullWidth size="large" variant="outlined" color="primary" onClick={() => setShown(true)}>표현 보기</Button>
            )}
          </Card>
          {shown ? <OxBar onX={() => grade(1)} onO={() => grade(3)} /> : null}
        </main>
      </>
    )

  return (
    <>
      <Top title="저장한 표현" back="/read" />
      <main className="page">
        {err ? <ErrorBox error={err} /> : null}
        {!items && !err ? <Skeleton height={200} radius={12} /> : null}
        {items ? (
          <>
            <Button fullWidth size="large" disabled={!due.length} onClick={() => setReview(true)}>
              {due.length ? `복습 ${due.length}개` : '오늘 복습할 표현 없음'}
            </Button>
            {!items.length ? <p className="rd-sub">기사 「표현」 단계에서 고른 표현이 여기 모여요.</p> : null}
            <ul className="ex-list">
              {items.map((x) => (
                <li key={x.id}>
                  <div>
                    <b lang="de">{x.base}</b>
                    <span>{x.meaning_ko}</span>
                    {x.sentence ? <small lang="de">{x.sentence}</small> : null}
                  </div>
                  <Button size="xsmall" variant="text" onClick={() => del(x.id)}>지우기</Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </main>
    </>
  )
}
