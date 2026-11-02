// 기사 화면(v11 R1 결정 = 가 단계 수업형): 미리보기 → 본문 → 표현 → 퀴즈. 본문 19px · 줄 간격 175%, 새 단어만 점선
import { useEffect, useMemo, useState } from 'react'
import { BottomSheet, Button, Card, ContentBadge, Skeleton, StepIndicator, Switch } from '../k/index.tsx'
import { IconPlay } from '../k/icons.tsx'
import { api, errorText } from '../api.ts'
import { articleApi, readFs, saveReadFs, speak, stopSpeak, tokenize, type Article as Art, type Gloss, type Quiz } from '../articles.ts'
import { navigate } from '../router.ts'
import { ErrorBox, Top, useToaster } from '../ui.tsx'
import './read.css'

const STEPS = ['미리보기', '본문', '표현', '퀴즈']

export default function Article({ id }: { id: number }) {
  const toast = useToaster()
  const [a, setA] = useState<Art | null>(null)
  const [err, setErr] = useState<string>()
  const [step, setStep] = useState(0)
  const [fs, setFs] = useState(readFs)

  useEffect(() => {
    let live = true
    articleApi.one(id).then(
      (x) => {
        if (!live) return
        setA(x)
        if (x.status === 'ready') articleApi.progress(id, { opened: true }).catch(() => undefined)
      },
      (e) => live && setErr(errorText(e)),
    )
    return () => {
      live = false
      stopSpeak()
    }
  }, [id])

  const cycleFs = () => {
    const n = fs === 17 ? 19 : fs === 19 ? 21 : 17
    setFs(n)
    saveReadFs(n)
  }

  const l = a?.lesson
  return (
    <>
      <Top title="오늘의 기사" back="/read" />
      <main className="page art" style={{ ['--rd-fs' as string]: `${fs}px` }}>
        {err ? <ErrorBox error={err} /> : null}
        {!a && !err ? <Skeleton height={320} radius={12} /> : null}
        {a && !l ? <Card><p>이 기사의 공부 자료가 아직 없어요.</p></Card> : null}
        {a && l ? (
          <>
            <div className="art-bar">
              <StepIndicator steps={STEPS} current={step} />
              <button type="button" className="art-fs" aria-label={`글자 크기 ${fs}`} onClick={cycleFs}>
                가<small>{fs}</small>
              </button>
            </div>
            {step === 0 ? <Preview a={a} onNext={() => setStep(1)} /> : null}
            {step === 1 ? <Body a={a} toast={toast} onNext={() => setStep(2)} /> : null}
            {step === 2 ? <Expressions a={a} toast={toast} onSaved={(saved) => setA({ ...a, saved })} onNext={() => setStep(3)} /> : null}
            {step === 3 ? <QuizStep a={a} onDone={(score) => articleApi.progress(a.id, { done: true, quiz_score: score }).then(() => setA({ ...a, status: 'done', quiz_score: score }), () => undefined)} /> : null}
          </>
        ) : null}
      </main>
    </>
  )
}

function Preview({ a, onNext }: { a: Art; onNext: () => void }) {
  const l = a.lesson!
  const key = l.key.map((k) => l.glossary.find((g) => g.lemma === k)).filter(Boolean) as Gloss[]
  return (
    <section className="art-step">
      <p className="rd-cap">{a.category ?? 'KBS WORLD'} · {a.words}단어</p>
      <h2 className="rd-title" lang="de">{a.title}</h2>
      <Card>
        <p className="rd-cap">한국어 요약</p>
        <ol className="art-sum">{l.summary_ko.map((s) => <li key={s}>{s}</li>)}</ol>
      </Card>
      {key.length ? (
        <Card>
          <p className="rd-cap">핵심 단어</p>
          <ul className="art-key">
            {key.map((g) => (
              <li key={g.lemma}>
                <b lang="de">{g.gender ? <i className={`g-${g.gender}`}>{g.gender} </i> : null}{g.lemma}</b>
                <span>{g.gloss_ko}</span>
                <ContentBadge variant="solid" accentColor={g.level === 'B1' ? 'semantic.foreground.brand.primary' : g.level === 'B2' ? 'semantic.foreground.accent.violet' : 'semantic.foreground.accent.pink'}>{g.level}</ContentBadge>
                {a.deck[g.lemma] ? <small>단어장</small> : <small className="nw-tag">새 단어</small>}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <div className="art-next"><Button fullWidth size="large" onClick={onNext}>본문 읽기</Button></div>
    </section>
  )
}

function Body({ a, toast, onNext }: { a: Art; toast: ReturnType<typeof useToaster>; onNext: () => void }) {
  const l = a.lesson!
  const [tr, setTr] = useState(false)
  const [one, setOne] = useState(false)
  const [i, setI] = useState(0)
  const [sheet, setSheet] = useState<Gloss | null>(null)
  const [asked, setAsked] = useState<Set<string>>(new Set())
  const toks = useMemo(() => l.sentences.map((s) => tokenize(s.de, l.glossary)), [l])

  const add = async (g: Gloss) => {
    try {
      await api.addRequest(g.lemma, a.url)
      setAsked((s) => new Set(s).add(g.lemma))
      toast('단어장에 넣어 달라고 했어요 · 다음 날 아침 들어와요', 'positive')
    } catch (e) {
      toast(errorText(e), 'negative')
    }
  }
  const sentence = (k: number) => (
    <p key={k} className="art-s" lang="de">
      {toks[k].map((t, j) =>
        t.g ? (
          <button key={j} type="button" className={a.deck[t.g.lemma] ? 'w' : 'w nw'} onClick={() => setSheet(t.g!)}>
            {t.t}
          </button>
        ) : (
          <span key={j}>{t.t}</span>
        ),
      )}
      {tr ? <span className="art-tr" lang="ko">{l.sentences[k].ko}</span> : null}
    </p>
  )
  return (
    <section className="art-step">
      <div className="art-tools">
        <label className="art-sw">번역 <Switch aria-label="번역" checked={tr} onCheckedChange={setTr} /></label>
        <label className="art-sw">한 문장씩 <Switch aria-label="한 문장씩" checked={one} onCheckedChange={setOne} /></label>
      </div>
      {one ? (
        <div className="art-one">
          <p className="rd-cap">{i + 1} / {l.sentences.length} 문장</p>
          {sentence(i)}
          <div className="art-row2">
            <Button variant="outlined" color="assistive" size="large" onClick={() => speak(l.sentences[i].de) || toast('이 기기에 독일어 음성이 없어요')}><IconPlay size={18} /> 듣기</Button>
            <Button variant="outlined" color="assistive" size="large" onClick={() => setTr((x) => !x)}>번역</Button>
          </div>
          <div className="art-row2">
            <Button variant="outlined" color="primary" size="large" disabled={i === 0} onClick={() => setI(i - 1)}>이전</Button>
            {i < l.sentences.length - 1 ? <Button size="large" onClick={() => setI(i + 1)}>다음</Button> : <Button size="large" onClick={onNext}>표현으로</Button>}
          </div>
        </div>
      ) : (
        <>
          <div className="art-text">{l.sentences.map((_, k) => sentence(k))}</div>
          <div className="art-row2">
            <Button variant="outlined" color="assistive" size="large" onClick={() => speak(l.sentences.map((s) => s.de).join(' ')) || toast('이 기기에 독일어 음성이 없어요')}><IconPlay size={18} /> 듣기</Button>
            <a className="k-btn k-btn-tertiary k-btn-large art-src" href={a.url} target="_blank" rel="noreferrer">원문 보기</a>
          </div>
          <div className="art-next"><Button fullWidth size="large" onClick={onNext}>표현으로</Button></div>
        </>
      )}
      <BottomSheet open={!!sheet} onClose={() => setSheet(null)} title={sheet ? <span lang="de">{sheet.gender ? <i className={`g-${sheet.gender}`}>{sheet.gender} </i> : null}{sheet.lemma}</span> : null}>
        {sheet ? (
          <>
            <p className="art-mean">{sheet.gloss_ko}</p>
            <p className="rd-sub">본문 꼴 <b lang="de">{sheet.form}</b> · {sheet.level}</p>
            {a.deck[sheet.lemma] ? (
              <Button fullWidth size="large" variant="outlined" color="primary" onClick={() => navigate(`/word/${a.deck[sheet.lemma].id}`)}>
                단어장에 있음 · {a.deck[sheet.lemma].learned ? '배움' : '아직'} — 단어 보기
              </Button>
            ) : (
              <Button fullWidth size="large" disabled={asked.has(sheet.lemma)} onClick={() => add(sheet)}>
                {asked.has(sheet.lemma) ? '넣어 달라고 했어요' : '+ 단어장'}
              </Button>
            )}
            <Button fullWidth size="large" variant="outlined" color="assistive" onClick={() => speak(sheet.lemma) || toast('이 기기에 독일어 음성이 없어요')}><IconPlay size={18} /> 듣기</Button>
          </>
        ) : null}
      </BottomSheet>
    </section>
  )
}

function Expressions({ a, toast, onSaved, onNext }: { a: Art; toast: ReturnType<typeof useToaster>; onSaved: (s: string[]) => void; onNext: () => void }) {
  const l = a.lesson!
  const [pick, setPick] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const toggle = (b: string) => setPick((s) => {
    const n = new Set(s)
    if (n.has(b)) n.delete(b)
    else n.add(b)
    return n
  })
  const save = async () => {
    const items = l.expressions.filter((e) => pick.has(e.base)).map((e) => ({ base: e.base, meaning_ko: e.meaning_ko, sentence: l.sentences[e.s]?.de }))
    if (!items.length) return onNext()
    setBusy(true)
    try {
      await articleApi.saveExprs(a.id, items)
      onSaved([...new Set([...a.saved, ...items.map((x) => x.base)])])
      toast(`표현 ${items.length}개 저장 · 내일부터 복습`, 'positive')
      onNext()
    } catch (e) {
      toast(errorText(e), 'negative')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="art-step">
      <p className="rd-sub">외우고 싶은 표현을 고르세요. 격 자리(jemandem · etwas)까지 붙인 꼴이에요.</p>
      <ul className="art-ex">
        {l.expressions.map((e) => {
          const saved = a.saved.includes(e.base)
          const on = saved || pick.has(e.base)
          return (
            <li key={e.base}>
              <button type="button" className={on ? 'on' : ''} disabled={saved} aria-pressed={on} onClick={() => toggle(e.base)}>
                <b lang="de">{e.base}</b>
                <span>{e.meaning_ko}{saved ? ' · 저장됨' : ''}</span>
                <small lang="de">{l.sentences[e.s]?.de}</small>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="art-row2">
        <Button variant="outlined" color="assistive" size="large" onClick={onNext}>넘기기</Button>
        <Button size="large" loading={busy} onClick={save}>{pick.size ? `${pick.size}개 저장` : '퀴즈로'}</Button>
      </div>
    </section>
  )
}

function QuizStep({ a, onDone }: { a: Art; onDone: (score: number) => void }) {
  const q = a.lesson!.quiz
  const [k, setK] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [end, setEnd] = useState(false)
  if (end)
    return (
      <section className="art-step art-end">
        <h2>오늘의 기사 끝</h2>
        <p className="art-ox"><b>O {score}</b> · X {q.length - score}</p>
        <Button fullWidth size="large" onClick={() => navigate('/read')}>읽기로</Button>
        <Button fullWidth size="large" variant="outlined" color="primary" onClick={() => navigate('/expressions')}>저장한 표현</Button>
      </section>
    )
  const x: Quiz = q[k]
  const options = x.type === 'article' ? ['der', 'die', 'das'] : x.options
  const answer = x.type === 'article' ? ['der', 'die', 'das'].indexOf(x.answer) : x.answer
  const choose = (i: number) => {
    if (picked !== null) return
    setPicked(i)
    if (i === answer) setScore((s) => s + 1)
  }
  const next = () => {
    if (k === q.length - 1) {
      setEnd(true)
      onDone(score)
    } else {
      setK(k + 1)
      setPicked(null)
    }
  }
  return (
    <section className="art-step">
      <p className="rd-cap">퀴즈 {k + 1} / {q.length}</p>
      {x.type === 'article' ? (
        <p className="art-q">관사는? <b lang="de">{x.noun}</b></p>
      ) : x.type === 'cloze' ? (
        <p className="art-q art-cloze" lang="de">{x.text}</p>
      ) : (
        <p className="art-q">{x.q_ko}</p>
      )}
      <div className={x.type === 'article' ? 'art-opts art-opts3' : 'art-opts'}>
        {options.map((o, i) => (
          <button key={o + i} type="button" lang={x.type === 'topic' || x.type === 'detail' ? 'ko' : 'de'}
            className={picked === null ? '' : i === answer ? 'ok' : i === picked ? 'bad' : 'dim'} onClick={() => choose(i)}>
            {o}
          </button>
        ))}
      </div>
      {picked !== null ? (
        <>
          <p className={picked === answer ? 'art-fb ok' : 'art-fb bad'}>{picked === answer ? 'O' : `X 정답 ${options[answer]}`}</p>
          <Button fullWidth size="large" onClick={next}>{k === q.length - 1 ? '끝' : '다음'}</Button>
        </>
      ) : null}
    </section>
  )
}
