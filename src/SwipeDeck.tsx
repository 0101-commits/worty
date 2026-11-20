// 카드 화면(기획 v11 5절): 그림(4:3, 잘리지 않게) · 단어 · 예문 · 큰 버튼 X / O(뒤집은 뒤).
// 밀어서 채점: ← X(다시) · → O(좋음). 세션의 「카드 뒤집기」 단계와 넘겨 보기(Drill)가 같이 쓴다.
// 구조는 21st.dev swipe-deck(ddoemonn, MIT)를 참고해 다시 썼다(Tailwind 없음).
import { speak } from './tts.ts'
import { IconPlay } from './k/icons.tsx'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform, type MotionValue } from 'motion/react'
import { Button, OxBar } from './k/index.tsx'
import type { DeckItem, Rating, Word, WordPart } from '../shared/api.ts'
import { hyphenate, pieces } from './hyphen.ts'
import { SWIPE, decideSwipe, isWeak } from './deck.ts'
import { OX_RATING, sinceLabel } from './session.ts'
import { T } from './text.ts'
import { imgSrc } from './api.ts'
import { article } from './format.ts'
import { modalOpen } from './screens/Quiz.tsx'
import { Example, LevelBadge, POS_LABEL, WeakBadge } from './ui.tsx'
import './screens/session.css'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export interface DeckCardRef {
  key: string
  item: DeckItem
}

interface Props {
  cards: DeckCardRef[] // [0] 이 맨 위, 최대 3장(세션은 1장)
  onGrade: (r: Rating) => void
  /** 있으면 Z 키로 되돌리기 */
  onUndo?: () => void
}

/** 글씨 맞춤 최소 크기(v13 U1) */
const MIN_FONT = 20

/**
 * 긴 낱말 글씨 맞춤(v13 U1): 안 끊기는 조각(합성어 풀이가 있으면 조각, 없으면 낱말 통째)이 칸보다 넓으면
 * 1px 씩 줄인다(최소 20px). 그래도 넘치면 음절 자리에서 끊는다. 칸 폭이 바뀌면 다시 잰다.
 */
function useFitWord(ref: RefObject<HTMLElement | null>, lemma: string, parts: WordPart[] | null | undefined) {
  const [fit, setFit] = useState<{ size: number | null; syl: boolean }>({ size: null, syl: false })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !el.parentElement || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const avail = el.clientWidth
      if (!avail) return
      // 같은 class 의 숨은 복사본으로 잰다(글자 크기를 바꾼 이 요소의 style 은 건드리지 않음)
      const probe = el.cloneNode(false) as HTMLElement
      probe.removeAttribute('style')
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;top:0;display:inline'
      el.parentElement!.appendChild(probe)
      const base = parseFloat(getComputedStyle(probe).fontSize)
      const first = parts?.length ? pieces(hyphenate(lemma, parts, 'parts')) : lemma.split(/\s+/)
      const widest = (size: number) => {
        probe.style.fontSize = size + 'px'
        let w = 0
        for (const t of first) {
          probe.textContent = t
          w = Math.max(w, probe.getBoundingClientRect().width)
        }
        return w
      }
      let size = base
      while (size > MIN_FONT && widest(size) > avail) size--
      const syl = widest(size) > avail
      probe.remove()
      const next = { size: size < base ? size : null, syl }
      setFit((v) => (v.size === next.size && v.syl === next.syl ? v : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, lemma, parts])
  return fit
}

/** 관사 색(der 파랑 · die 빨강 · das 초록) + 단어. fit = 칸 폭에 맞춰 글씨 줄이기 · 끊는 자리(카드 앞뒷면) */
export function CardWord({ word, className = '', fit = false }: { word: Pick<Word, 'lemma' | 'pos' | 'gender' | 'parts'>; className?: string; fit?: boolean }) {
  const a = article(word)
  const g = a === 'der' || a === 'die' || a === 'das' ? a : ''
  const ref = useRef<HTMLSpanElement>(null)
  const f = useFitWord(fit ? ref : NO_REF, word.lemma, word.parts)
  // 맞춤 전 · 조각이 들어가면 합성어 경계에서만, 안 들어가면 음절에서도 끊음
  const text = !fit ? hyphenate(word.lemma, word.parts) : f.syl ? hyphenate(word.lemma, word.parts, 'syllables') : word.parts?.length ? hyphenate(word.lemma, word.parts, 'parts') : word.lemma
  return (
    <span ref={ref} className={'fc-word ' + className + (fit ? ' fit' : '')} lang="de" style={f.size ? { fontSize: f.size } : undefined}>
      {a && <span className={'fc-art' + (g ? ' g-' + g : '')}>{a} </span>}
      {text}
    </span>
  )
}
const NO_REF: RefObject<HTMLElement | null> = { current: null }

/** 합성어 풀이 한 줄(v13 L4): Geschwindigkeit 속도 + s + Beschränkung 제한. 뜻이 하나도 없으면 안 그림 */
export function PartsLine({ parts, className = 'fc-parts' }: { parts: WordPart[] | null | undefined; className?: string }) {
  if (!parts || parts.length < 2 || !parts.some((x) => x.ko)) return null
  return (
    <p className={className}>
      {parts.map((x, i) => (
        <span key={i}>
          {i > 0 && ' + '}
          <b lang="de">{x.p}</b>
          {x.ko && !x.link ? ' ' + x.ko : ''}
        </span>
      ))}
    </p>
  )
}

/** 그림 칸(4:3, object-fit contain — 두 칸 그림도 잘리지 않게). 그림이 없거나 못 받으면 예문을 크게 */
export function CardPicture({ word, showKo = false }: { word: Word; showKo?: boolean }) {
  const [broken, setBroken] = useState(false)
  if (word.image && !broken)
    return (
      <div className="fc-pic">
        <img src={imgSrc(word.id)} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />
      </div>
    )
  return (
    <div className="fc-pic fc-pic-ex">
      {word.example_de ? (
        <p className="fc-ex-big">
          <span lang="de">
            <Example de={word.example_de} lemma={word.lemma} hit={word.example_hit} />
          </span>
          {showKo && word.example_ko && <span className="ko">{word.example_ko}</span>}
        </p>
      ) : (
        <CardWord word={word} className="fc-word-big" />
      )}
    </div>
  )
}

/** 카드 한 면. back = 뜻 · 예문(단어 강조) · 번역. 소개 카드도 뒷면을 쓴다 */
/** ▶ 소리(폰 독일어 음성). 카드 뒤집기·밀기로 번지지 않게 누름을 여기서 멈춘다 */
export function SpeakButton({ text }: { text: string }) {
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  return (
    <button type="button" className="fc-speak" aria-label="소리 듣기" onPointerDown={stop} onPointerUp={stop} onTouchStart={stop}
      onClick={(e) => {
        e.stopPropagation()
        speak(text)
      }}>
      <IconPlay size={16} />
    </button>
  )
}

export function CardFace({ item: { word, card }, back }: { item: DeckItem; back: boolean }) {
  const s = sinceLabel(card)
  return (
    <>
      <CardPicture word={word} showKo={back} />
      <div className="fc-body">
        {/* 낱말은 한 줄 전체(v13 U1: ▶·칩이 같은 줄에 있어 글자 칸이 2/3뿐이었다) */}
        <CardWord word={word} className={back ? 'sm' : ''} fit />
        {back && <PartsLine parts={word.parts} />}
        <div className="fc-meta">
          <SpeakButton text={(article(word) ? article(word) + ' ' : '') + word.lemma} />
          <span className={'fc-since ' + s.tone}>{s.text}</span>
          <span>{POS_LABEL[word.pos] ?? word.pos}</span>
          <LevelBadge level={word.level} />
          {isWeak(card) && <WeakBadge />}
          {word.plural && <span lang="de">{T.plural(word.plural)}</span>}
        </div>
        {back && (
          <>
            <p className="fc-mean">{word.gloss_ko ?? T.meaningPending}</p>
            {/* 그림이 있을 때만 — 그림이 없으면 위 칸에 예문 · 번역이 이미 크게 있다 */}
            {word.image && word.example_de && (
              <p className="fc-ex">
                <span lang="de">
                  <Example de={word.example_de} lemma={word.lemma} hit={word.example_hit} />
                </span>
                {word.example_ko && <span className="ko">{word.example_ko}</span>}
              </p>
            )}
          </>
        )}
      </div>
    </>
  )
}

export function SwipeDeck({ cards, onGrade, onUndo }: Props) {
  const top = cards[0]
  const stage = useRef<HTMLDivElement>(null)
  // 위 카드가 자기 함수를 여기에 걸어 둔다 → X·O 버튼·키보드가 같은 날아가기를 쓴다
  const ctl = useRef<TopControl | null>(null)
  // 뒤집힌 카드 열쇠(카드가 바뀌면 저절로 앞면)
  const [flippedKey, setFlippedKey] = useState<string | null>(null)
  const flipped = !!top && flippedKey === top.key
  const flip = () => top && setFlippedKey((k) => (k === top.key ? null : top.key))

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    // ⋯ 메뉴 · 창이 열려 있으면 뒤 카드를 채점·뒤집지 않는다
    if (modalOpen()) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      ctl.current?.commit(e.key === 'ArrowLeft' ? OX_RATING.x : OX_RATING.o)
    } else if (e.key === ' ') {
      e.preventDefault()
      flip()
    } else if ((e.key === 'z' || e.key === 'Z') && onUndo) {
      if (!ctl.current?.busy()) onUndo()
    }
  })
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  return (
    <>
      {/* 뒤 카드 크기·높이는 CSS 변수 --p(위 카드를 민 정도 0~1)와 --d(깊이)로만 정한다 */}
      <div className={'sd-stage' + (cards.length > 1 ? ' stack' : '')} ref={stage}>
        {cards
          .map((c, depth) => ({ c, depth }))
          .reverse()
          .map(({ c, depth }) =>
            depth === 0 ? (
              <TopCard key={c.key} item={c.item} back={flipped} onFlip={flip} stage={stage} ctl={ctl} onGrade={onGrade} />
            ) : (
              <div key={c.key} className="fc behind" aria-hidden style={{ '--d': depth, zIndex: 3 - depth } as CSSProperties}>
                <CardFace item={c.item} back={false} />
              </div>
            ),
          )}
      </div>
      <p className="keys">{T.keysFlip}</p>
      <div className="ss-bar">
        <div className="ss-bar-in">
          {flipped ? (
            <OxBar onX={() => ctl.current?.commit(OX_RATING.x)} onO={() => ctl.current?.commit(OX_RATING.o)} disabled={!top} />
          ) : (
            <Button fullWidth size="large" onClick={flip} disabled={!top}>
              {T.showBack}
            </Button>
          )}
        </div>
      </div>
    </>
  )
}

interface TopControl {
  commit: (r: Rating) => void
  busy: () => boolean
}

/** 맨 위 카드. 카드마다 새로 붙으므로(key) 이동·기울기 값이 다음 카드로 새지 않는다. */
function TopCard(props: {
  item: DeckItem
  back: boolean
  onFlip: () => void
  stage: RefObject<HTMLDivElement | null>
  ctl: RefObject<TopControl | null>
  onGrade: (r: Rating) => void
}) {
  const { item, back, onFlip, stage, ctl, onGrade } = props
  const x = useMotionValue(0)
  const rotate = useTransform(x, (v) => clamp(v / SWIPE.TILT_DIV, -SWIPE.TILT_MAX, SWIPE.TILT_MAX))
  const busy = useRef(false)
  const alive = useRef(false)
  const tap = useRef<{ t: number; x: number; y: number } | null>(null)

  const setProgress = () => stage.current?.style.setProperty('--p', String(Math.min(1, Math.abs(x.get()) / SWIPE.COMMIT_X)))
  useMotionValueEvent(x, 'change', setProgress)
  useLayoutEffect(() => {
    alive.current = true
    setProgress()
    return () => {
      alive.current = false // 날아가는 사이 되돌리기로 내려가면 채점하지 않는다
    }
  }, [])

  const commit = (r: Rating) => {
    if (busy.current) return
    busy.current = true
    animate(x, r >= 2 ? SWIPE.EXIT_PX : -SWIPE.EXIT_PX, { duration: SWIPE.EXIT_MS / 1000, ease: 'easeIn' }).then(() => {
      if (alive.current) onGrade(r)
    })
  }
  useLayoutEffect(() => {
    ctl.current = { commit, busy: () => busy.current }
  })

  return (
    <motion.div
      className="fc top"
      data-testid="deck-top"
      drag="x"
      dragMomentum={false}
      style={{ x, rotate, zIndex: 3 }}
      onPointerDown={(e) => (tap.current = { t: e.timeStamp, x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        const s = tap.current
        tap.current = null
        if (s && e.timeStamp - s.t < SWIPE.TAP_MS && Math.hypot(e.clientX - s.x, e.clientY - s.y) < SWIPE.TAP_PX) onFlip()
      }}
      onDragEnd={(_, info) => {
        if (busy.current) return
        const r = decideSwipe(x.get(), 0, info.velocity.x / 1000, 0, 2)
        if (r) return commit(r === 1 ? OX_RATING.x : OX_RATING.o)
        animate(x, 0, { duration: SWIPE.SNAP_MS / 1000, ease: 'easeOut' })
      }}
      role="button"
      tabIndex={0}
      aria-label={back ? '앞면 보기' : T.showBack}
    >
      <Stamps x={x} />
      <CardFace item={item} back={back} />
    </motion.div>
  )
}

/** 미는 방향의 도장(X · O). 불투명도 = 이동 / 80 */
function Stamps({ x }: { x: MotionValue<number> }) {
  const o = useTransform(x, (v) => clamp(v / SWIPE.STAMP_DIV, 0, 1))
  const no = useTransform(x, (v) => clamp(-v / SWIPE.STAMP_DIV, 0, 1))
  return (
    <>
      <motion.span className="fc-stp o" style={{ opacity: o }} aria-hidden>
        {T.o}
      </motion.span>
      <motion.span className="fc-stp x" style={{ opacity: no }} aria-hidden>
        {T.x}
      </motion.span>
    </>
  )
}
