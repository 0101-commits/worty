// 기사 화면(v11 R1 결정 = 가 단계 수업형): 미리보기 → 본문 → 표현 → 퀴즈. 본문 19px · 줄 간격 175%, 새 단어만 점선
import { useEffect, useMemo, useState } from 'react'
import { BottomSheet, Button, Card, ContentBadge, Skeleton, StepIndicator, Switch } from '../k/index.tsx'
import { IconPlay } from '../k/icons.tsx'
import { api, errorText } from '../api.ts'
import { articleApi, readFs, saveReadFs, speak, stopSpeak, tokenize, type Article as Art, type Gloss, type Quiz } from '../articles.ts'
import { useAsync } from '../hooks.ts'
import { navigate } from '../router.ts'
import type { LookupItem } from '../../shared/api.ts'
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
            {step === 1 ? <Body a={a} toast={toast} onDeck={(lemma, e) => setA((x) => (x ? { ...x, deck: { ...x.deck, [lemma]: e } } : x))} onNext={() => setStep(2)} /> : null}
            {step === 2 ? <Expressions a={a} toast={toast} onSaved={(saved) => setA({ ...a, saved })} onNext={() => setStep(3)} /> : null}
            {step === 3 ? (
              <QuizStep
                a={a}
                onDone={(score) =>
                  articleApi.progress(a.id, { done: true, quiz_score: score }).then(
                    () => setA({ ...a, status: 'done', quiz_score: score }),
                    (e) => toast(`다 읽음 저장 실패 · ${errorText(e)}`, 'negative'),
                  )
                }
              />
            ) : null}
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

/** 본문에서 누른 낱말: 공부 자료 낱말(g)이면 그 뜻, 아니면 단어장을 꼴로 찾는다. s = 문장 번호 */
type Pick = { form: string; g?: Gloss; s: number }
type DeckEntry = Art['deck'][string]
const WORD_RE = /([A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*)/
/** 네이버 독일어 사전(활용형도 찾아 준다) */
const dictUrl = (w: string) => `https://dict.naver.com/dekodict/#/search?query=${encodeURIComponent(w)}`

function Body({ a, toast, onDeck, onNext }: { a: Art; toast: ReturnType<typeof useToaster>; onDeck: (lemma: string, e: DeckEntry) => void; onNext: () => void }) {
  const l = a.lesson!
  const [tr, setTr] = useState(false)
  const [one, setOne] = useState(false)
  const [i, setI] = useState(0)
  const [sheet, setSheet] = useState<Pick | null>(null)
  const toks = useMemo(() => l.sentences.map((s) => tokenize(s.de, l.glossary)), [l])

  // 다음 단계로 넘어가면 읽던 소리를 멈춘다
  useEffect(() => () => stopSpeak(), [])
  const say = (text: string) => speak(text) || toast('이 기기에 독일어 음성이 없어요')
  const sentence = (k: number) => (
    <p key={k} className="art-s" lang="de">
      {toks[k].map((t, j) =>
        t.g ? (
          <button key={j} type="button" className={a.deck[t.g.lemma] ? 'w' : 'w nw'} onClick={() => setSheet({ form: t.t, g: t.g, s: k })}>
            {t.t}
          </button>
        ) : (
          // 공부 자료에 없는 낱말도 누를 수 있게(단어장 찾기 · 넣기)
          t.t.split(WORD_RE).map((x, m) =>
            m % 2 === 1 && x.length > 1 ? (
              <button key={`${j}.${m}`} type="button" className="w" onClick={() => setSheet({ form: x, s: k })}>
                {x}
              </button>
            ) : (
              <span key={`${j}.${m}`}>{x}</span>
            ),
          )
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
      <p className="rd-sub">모르는 낱말을 누르면 뜻을 찾고 단어장에 넣을 수 있어요.</p>
      {one ? (
        <div className="art-one">
          <p className="rd-cap">{i + 1} / {l.sentences.length} 문장</p>
          {sentence(i)}
          <div className="art-row2">
            <Button variant="outlined" color="assistive" size="large" onClick={() => say(l.sentences[i].de)}><IconPlay size={18} /> 듣기</Button>
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
            <Button variant="outlined" color="assistive" size="large" onClick={() => say(l.sentences.map((s) => s.de).join(' '))}><IconPlay size={18} /> 듣기</Button>
            <a className="k-btn k-btn-tertiary k-btn-large art-src" href={a.url} target="_blank" rel="noreferrer">원문 보기</a>
          </div>
          <div className="art-next"><Button fullWidth size="large" onClick={onNext}>표현으로</Button></div>
        </>
      )}
      <BottomSheet
        open={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet ? <span lang="de">{sheet.g?.gender ? <i className={`g-${sheet.g.gender}`}>{sheet.g.gender} </i> : null}{sheet.g?.lemma ?? sheet.form}</span> : null}
      >
        {sheet ? <WordSheet key={`${sheet.s}|${sheet.form}`} a={a} pick={sheet} toast={toast} onDeck={onDeck} say={say} /> : null}
      </BottomSheet>
    </section>
  )
}

const STUDY_MSG = { new: '오늘 새 단어 맨 앞에 넣었어요', review: '오늘 복습에 넣었어요', already: '이미 오늘 공부에 있어요' } as const

/** 낱말 시트: 뜻 · 단어장 상태 · 오늘 공부에 넣기 / 단어장에 넣기 · 듣기 · 사전 */
function WordSheet({ a, pick, toast, onDeck, say }: { a: Art; pick: Pick; toast: ReturnType<typeof useToaster>; onDeck: (lemma: string, e: DeckEntry) => void; say: (t: string) => unknown }) {
  const g = pick.g
  const inDeck = g ? a.deck[g.lemma] : undefined
  // 공부 자료에 없는 낱말: 꼴로 단어장 찾기
  const found = useAsync(() => (g ? Promise.resolve(null) : api.lookup(pick.form).then((r) => r.items[0] ?? null, () => null)), [pick.form, !!g])
  const hit: LookupItem | null = found.data ?? null
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const sent = a.lesson!.sentences[pick.s]
  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    try {
      const msg = await fn()
      setDone(msg)
      toast(msg, 'positive')
    } catch (e) {
      toast(errorText(e), 'negative')
    } finally {
      setBusy(false)
    }
  }
  const deckRow = (id: string, learned: boolean, lemma: string) => (
    <>
      <Button fullWidth size="large" loading={busy} disabled={!!done} onClick={() => run(async () => STUDY_MSG[(await api.studyToday(id)).mode])}>
        {done ?? '오늘 공부에 넣기'}
      </Button>
      <Button fullWidth size="large" variant="outlined" color="primary" onClick={() => navigate(`/word/${id}`)}>
        단어장에 있음 · {learned ? '배운 단어' : '아직 안 배움'} — <span lang="de">{lemma}</span> 보기
      </Button>
    </>
  )
  const term = g?.lemma ?? hit?.lemma ?? pick.form
  return (
    <>
      {g ? (
        <>
          <p className="art-mean">{g.gloss_ko}</p>
          <p className="rd-sub">본문 꼴 <b lang="de">{g.form}</b> · {g.level}</p>
        </>
      ) : found.loading ? (
        <Skeleton height={28} width="60%" />
      ) : hit ? (
        <>
          <p className="art-mean">{hit.gloss_ko ?? '뜻 준비 중'}</p>
          <p className="rd-sub">
            본문 꼴 <b lang="de">{pick.form}</b> → 기본형 <b lang="de">{hit.gender ? `${hit.gender} ` : ''}{hit.lemma}</b> · {hit.level}
          </p>
        </>
      ) : (
        <p className="rd-sub">단어장에 없는 낱말이에요. 넣으면 다음 날 아침에 뜻·예문을 붙여 새 단어 맨 앞에 들어와요.</p>
      )}
      {sent ? <p className="rd-sub" lang="ko">문장 뜻: {sent.ko}</p> : null}
      {g ? (
        inDeck ? (
          deckRow(inDeck.id, inDeck.learned, g.lemma)
        ) : (
          <Button
            fullWidth
            size="large"
            loading={busy}
            disabled={!!done}
            onClick={() =>
              run(async () => {
                const r = await articleApi.addWord(a.id, g.lemma)
                onDeck(g.lemma, { id: r.id, level: g.level, learned: false })
                return r.created ? '단어장에 넣었어요 · 오늘 새 단어 맨 앞' : STUDY_MSG[r.mode]
              })
            }
          >
            {done ?? '+ 단어장 · 오늘 공부'}
          </Button>
        )
      ) : hit ? (
        deckRow(hit.id, hit.learned, hit.lemma)
      ) : found.loading ? null : (
        <Button
          fullWidth
          size="large"
          loading={busy}
          disabled={!!done}
          onClick={() =>
            run(async () => {
              const r = await api.addRequest(pick.form, a.url)
              return r.duplicate ? '이미 넣어 달라고 했어요' : '넣어 달라고 했어요 · 다음 날 아침 들어와요'
            })
          }
        >
          {done ?? '+ 단어장(다음 날 아침)'}
        </Button>
      )}
      <div className="art-row2">
        <Button variant="outlined" color="assistive" size="large" onClick={() => say(term)}><IconPlay size={18} /> 듣기</Button>
        <a className="k-btn k-btn-tertiary k-btn-large art-src" href={dictUrl(term)} target="_blank" rel="noreferrer">사전</a>
      </div>
    </>
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
  const q = a.lesson!.quiz ?? []
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
  const x: Quiz | undefined = q[k]
  if (!x)
    return (
      <section className="art-step art-end">
        <h2>오늘의 기사 끝</h2>
        <Button fullWidth size="large" onClick={() => { onDone(0); navigate('/read') }}>읽기로</Button>
      </section>
    )
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
