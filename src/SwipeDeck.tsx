// 카드 화면(기획 v11 5절): 그림(4:3, 잘리지 않게) · 단어 · 예문 · 큰 버튼 X / O(뒤집은 뒤).
// 밀어서 채점: ← X(다시) · → O(좋음). 세션의 「카드 뒤집기」 단계와 넘겨 보기(Drill)가 같이 쓴다.
// 구조는 21st.dev swipe-deck(ddoemonn, MIT)를 참고해 다시 썼다(Tailwind 없음).
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform, type MotionValue } from 'motion/react'
import { Button, OxBar } from './k/index.tsx'
import type { DeckItem, Rating, Word } from '../shared/api.ts'
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

/** 관사 색(der 파랑 · die 빨강 · das 초록) + 단어 */
export function CardWord({ word, className = '' }: { word: Pick<Word, 'lemma' | 'pos' | 'gender'>; className?: string }) {
  const a = article(word)
  const g = a === 'der' || a === 'die' || a === 'das' ? a : ''
  return (
    <span className={'fc-word ' + className} lang="de">
      {a && <span className={'fc-art' + (g ? ' g-' + g : '')}>{a} </span>}
      {word.lemma}
    </span>
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
export function CardFace({ item: { word, card }, back }: { item: DeckItem; back: boolean }) {
  const s = sinceLabel(card)
  return (
    <>
      <CardPicture word={word} showKo={back} />
      <div className="fc-body">
        <div className="fc-row">
          <CardWord word={word} className={back ? 'sm' : ''} />
          <span className={'fc-since ' + s.tone}>{s.text}</span>
        </div>
        <div className="fc-meta">
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
