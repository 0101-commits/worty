// 단어 하나(v11): 단어 · 관사 · ▶ · 뜻 · 칩 · 그림 · 예문 · 「내 기록」(다음 복습 · O · X) · 제외 · 수정 요청
import { useState } from 'react'
import { Button, Card, ContentBadge, IconButton, Skeleton } from '../k/index.tsx'
import { IconPlay } from '../k/icons.tsx'
import { api, errorText, imgSrc } from '../api.ts'
import { articleApi } from '../articles.ts'
import { linkTo } from '../router.ts'
import { fmtDay } from '../format.ts'
import { useAsync } from '../hooks.ts'
import { ReportButton } from '../Report.tsx'
import { Example, ErrorBox, LevelBadge, Lemma, POS_LABEL, Top, useToaster } from '../ui.tsx'
import type { WordDetailResponse } from '../../shared/api.ts'
import './word-detail.css'

/** 브라우저 음성으로 독일어 읽기(없으면 조용히 건너뜀) */
function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'de-DE'
  window.speechSynthesis.speak(u)
}

/** 「다음 복습 11/13 · O 6 · X 1」 — 내부 용어(안정도 · 난이도) 없이 날짜와 O·X 수만 */
function myRecord(d: WordDetailResponse): string {
  const next = d.card.suspended ? '제외함' : d.card.state === 0 ? '아직 안 봄' : `다음 복습 ${fmtDay(d.card.due)}`
  return `${next} · O ${d.ox.o} · X ${d.ox.x}`
}

export default function WordDetail({ id }: { id: string }) {
  const r = useAsync(() => api.word(id), [id])
  const d = r.data
  return (
    <>
      <Top title="단어" back="/words" />
      <main className="page wdt-page">
        {r.error ? (
          <ErrorBox error={r.error} onRetry={r.reload} />
        ) : !d ? (
          <>
            <Skeleton variant="rectangle" width="100%" height={220} radius={16} />
            <Skeleton variant="text" width="50%" height={28} />
            <Skeleton variant="text" width="80%" height={18} />
          </>
        ) : (
          <Body key={d.word.id} d={d} reload={r.reload} />
        )}
      </main>
    </>
  )
}

function Body({ d, reload }: { d: WordDetailResponse; reload: () => void }) {
  const toast = useToaster()
  const [busy, setBusy] = useState(false)
  const [imgBroken, setImgBroken] = useState(false)
  const w = d.word
  const toggleSuspend = async () => {
    setBusy(true)
    try {
      await api.suspend(w.id, !d.card.suspended)
      toast(d.card.suspended ? '다시 복습에 넣었어요.' : '복습에서 제외했어요.', 'positive')
      reload()
    } catch (e) {
      toast(errorText(e), 'negative')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Card as="article" className="wdt-card">
        {w.image && !imgBroken && <img className="wdt-img" src={imgSrc(w.id)} alt="" draggable={false} onError={() => setImgBroken(true)} />}
        <div className="wdt-head">
          <Lemma word={w} className="wdt-lemma" />
          <IconButton size="medium" aria-label={`${w.lemma} 듣기`} onClick={() => speak((w.pos === 'noun' && w.gender ? w.gender + ' ' : '') + w.lemma)}>
            <IconPlay />
          </IconButton>
        </div>
        <div className="wdt-mean">{w.gloss_ko ?? '뜻 준비 중'}</div>
        <div className="wdt-chips">
          <ContentBadge size="xsmall" variant="outlined" color="neutral">{POS_LABEL[w.pos] ?? w.pos}</ContentBadge>
          <LevelBadge level={w.level} />
          {w.plural && <span lang="de" className="wdt-plural">복수 {w.plural}</span>}
        </div>
        {w.example_de && (
          <p className="wdt-ex">
            <span lang="de">
              <Example de={w.example_de} lemma={w.lemma} hit={w.example_hit} />
            </span>
            {w.example_ko && <span className="ko">{w.example_ko}</span>}
          </p>
        )}
      </Card>

      <InArticles id={w.id} />

      <Card className="wdt-rec">
        <h3>내 기록</h3>
        <p className="wdt-rec-line">{myRecord(d)}</p>
      </Card>

      <div className="wdt-actions">
        <Button variant="outlined" color="assistive" loading={busy} onClick={toggleSuspend}>
          {d.card.suspended ? '제외 풀기' : '제외'}
        </Button>
        <ReportButton wordId={w.id} lemma={w.lemma} className="k-btn k-btn-tertiary k-btn-medium">
          수정 요청
        </ReportButton>
      </div>
    </>
  )
}

/** 기사 속 문장(v11 4단계): 오늘의 기사에서 이 단어가 나온 문장, 최근 3개. 없으면 안 그린다 */
function InArticles({ id }: { id: string }) {
  const r = useAsync(() => articleApi.wordArticles(id), [id])
  const items = r.data?.items ?? []
  if (!items.length) return null
  return (
    <Card className="wdt-rec">
      <h3>기사 속 문장</h3>
      {items.map((x) => (
        <a key={x.article_id} className="wdt-art" {...linkTo(`/article/${x.article_id}`)}>
          <span lang="de">{x.de.split(x.form).flatMap((part, i, arr) => (i < arr.length - 1 ? [part, <b key={i}>{x.form}</b>] : [part]))}</span>
          <span className="ko">{x.ko}</span>
          <small>{x.day.slice(5).replace('-', '/')} · {x.title}</small>
        </a>
      ))}
    </Card>
  )
}
