// 단어(v11): 검색 한 줄 · 꼬리표 한 줄(상태·레벨·품사·그림) · 바로가기(자주 틀림·이번 주) · 순서 · 목록 · 「N개 연습」
// 검색은 움라우트를 푼 글자로 맞고(ae = ä), 앞의 der/die/das 는 무시, 한국어 뜻도 찾는다(서버 /api/words).
import { useEffect, useState, type ReactNode } from 'react'
import { BottomSheet, Button, Chip, ContentBadge, SearchField, Skeleton, TopNavigationButton, SegmentedControl, SegmentedControlItem } from '../k/index.tsx'
import { IconChevronDown, IconPlus } from '../k/icons.tsx'
import type { DeckItem, WordsCountsResponse } from '../../shared/api.ts'
import { api, errorText, imgSrc } from '../api.ts'
import { num } from '../format.ts'
import { useDebounced } from '../hooks.ts'
import { linkTo, navigate } from '../router.ts'
import { AddWord } from '../AddWord.tsx'
import { dayDiff } from '../format.ts'
import { EMPTY_FILTER, practiceParams, toQuery, type SortKey, type WordsFilter } from '../wordsFilter.ts'
import { Emoji, ErrorBox, Lemma, POS_LABEL, Top } from '../ui.tsx'
import './words.css'

const SIZE = 30
/** 연습 한 판 최대 장 수 */
const PRACTICE_MAX = 50

type Opt<T extends string> = Array<[T, string]>
const STATE_OPTS: Opt<WordsFilter['state']> = [['all', '전체'], ['new', '새 단어'], ['learning', '학습 중'], ['review', '복습'], ['suspended', '제외한 단어']]
const LEVEL_OPTS: Opt<WordsFilter['level']> = [['all', '전체'], ['B1', 'B1'], ['B2', 'B2'], ['C1', 'C1']]
const POS_OPTS: Opt<WordsFilter['pos']> = [['all', '전체'], ...(Object.entries(POS_LABEL) as Array<[WordsFilter['pos'], string]>)]
const IMAGE_OPTS: Opt<WordsFilter['image']> = [['all', '전체'], ['yes', '그림 있는 단어'], ['no', '그림 없는 단어']]
const SORT_OPTS: Opt<SortKey> = [['seq', '순서'], ['learned', '날짜'], ['alpha', '가나다']]

type SheetKey = 'state' | 'level' | 'pos' | 'image' | 'sort'
const TAGS: Array<{ key: Exclude<SheetKey, 'sort'>; name: string; opts: Opt<never> }> = [
  { key: 'state', name: '상태', opts: STATE_OPTS as Opt<never> },
  { key: 'level', name: '레벨', opts: LEVEL_OPTS as Opt<never> },
  { key: 'pos', name: '품사', opts: POS_OPTS as Opt<never> },
  { key: 'image', name: '그림', opts: IMAGE_OPTS as Opt<never> },
]
const OPTS: Record<SheetKey, Opt<never>> = { state: STATE_OPTS as Opt<never>, level: LEVEL_OPTS as Opt<never>, pos: POS_OPTS as Opt<never>, image: IMAGE_OPTS as Opt<never>, sort: SORT_OPTS as Opt<never> }
const SHEET_TITLE: Record<SheetKey, string> = { state: '상태', level: '레벨', pos: '품사', image: '그림', sort: '정렬' }

// 상세에 갔다 와도 거르기를 기억한다
let remembered: WordsFilter = EMPTY_FILTER

export default function Words({ add = '', url = '', open = false }: { add?: string; url?: string; open?: boolean }) {
  const [f, setF] = useState<WordsFilter>(remembered)
  const [sheet, setSheet] = useState<SheetKey | null>(null)
  const [addOpen, setAddOpen] = useState(open || Boolean(add || url))
  const dq = useDebounced(f.q.trim(), 300)
  const q = { ...f, q: dq }
  const key = JSON.stringify(toQuery(q))
  const [pager, setPager] = useState({ key, page: 1 })
  const page = pager.key === key ? pager.page : 1
  const [list, setList] = useState<{ key: string; items: DeckItem[]; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [tick, setTick] = useState(0)
  const [counts, setCounts] = useState<WordsCountsResponse | null>(null)
  const set = (p: Partial<WordsFilter>) => setF((x) => ({ ...x, ...p }))

  useEffect(() => {
    remembered = f
  }, [f])
  useEffect(() => {
    api.wordsCounts().then(setCounts, () => setCounts(null))
  }, [])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(undefined)
    api.words({ ...toQuery(q), page, size: SIZE }).then(
      (r) => {
        if (!live) return
        setList((prev) => ({ key, total: r.total, items: page > 1 && prev?.key === key ? [...prev.items, ...r.items] : r.items }))
        setLoading(false)
      },
      (e) => {
        if (!live) return
        setError(errorText(e))
        setLoading(false)
      },
    )
    return () => {
      live = false
    }
    // key 가 q·거르기 전부를 담는다
  }, [key, page, tick])

  const fresh = list?.key === key ? list : null // 거르기를 바꾼 직후엔 옛 목록을 감춘다
  const filtered = JSON.stringify(toQuery(q)) !== '{}'
  const n = fresh ? Math.min(fresh.total, PRACTICE_MAX) : 0
  const tagLabel = (t: (typeof TAGS)[number]) => {
    const v = f[t.key] as string
    return v === 'all' ? t.name : (t.opts.find(([o]) => o === v)?.[1] ?? t.name)
  }

  return (
    <>
      <Top
        title="단어"
        actions
        extra={
          <TopNavigationButton aria-label="단어 넣기" onClick={() => setAddOpen(true)}>
            <IconPlus />
          </TopNavigationButton>
        }
      />
      <main className="page wd-page">
        {/* v11 4단계: 표현은 기사에서 저장한 것 — 화면은 /expressions */}
        <SegmentedControl size="small" value="words" onValueChange={(v) => v === 'expr' && navigate('/expressions')} aria-label="단어 · 표현">
          <SegmentedControlItem value="words">단어</SegmentedControlItem>
          <SegmentedControlItem value="expr">표현</SegmentedControlItem>
        </SegmentedControl>
        <SearchField
          size="medium"
          placeholder="독일어 · 뜻 검색 (ae = ä)"
          value={f.q}
          onChange={(e) => set({ q: e.target.value })}
          onReset={() => set({ q: '' })}
          aria-label="단어 검색"
        />
        <div className="wd-tags" role="group" aria-label="거르기" data-hscroll>
          {TAGS.map((t) => (
            <Chip key={t.key} size="small" variant="outlined" active={f[t.key] !== 'all'} aria-haspopup="dialog" onClick={() => setSheet(t.key)}>
              {tagLabel(t)} <IconChevronDown size={16} />
            </Chip>
          ))}
        </div>
        <div className="wd-short" role="group" aria-label="바로가기">
          <Chip size="small" variant="outlined" active={f.weak} aria-pressed={f.weak} onClick={() => set({ weak: !f.weak })}>
            자주 틀림{counts ? ` ${num(counts.weak)}` : ''}
          </Chip>
          <Chip size="small" variant="outlined" active={f.week} aria-pressed={f.week} onClick={() => set({ week: !f.week })}>
            이번 주{counts ? ` ${num(counts.week)}` : ''}
          </Chip>
          {filtered && (
            <button type="button" className="wd-reset" onClick={() => set({ ...EMPTY_FILTER, sort: f.sort })}>
              거르기 풀기
            </button>
          )}
        </div>
        {fresh && (
          <div className="wd-bar">
            <span className="small muted">{num(fresh.total)}개</span>
            <button type="button" className="wd-sort" onClick={() => setSheet('sort')}>
              {SORT_OPTS.find(([o]) => o === f.sort)?.[1]} <IconChevronDown size={16} />
            </button>
          </div>
        )}

        {error && !loading ? (
          <ErrorBox error={error} onRetry={() => setTick((t) => t + 1)} />
        ) : !fresh ? (
          <div className="wd-list" aria-busy>
            {Array.from({ length: 6 }, (_, i) => (
              <div className="wd-sk" key={i}>
                <div className="wd-mid">
                  <Skeleton variant="text" width="55%" height={18} />
                  <Skeleton variant="text" width="35%" height={14} />
                </div>
              </div>
            ))}
          </div>
        ) : fresh.items.length === 0 ? (
          <div className="empty">
            <Emoji name="study" size={120} />
            <h2>{filtered ? '찾는 단어가 없어요' : '단어가 아직 없어요'}</h2>
            <p>{filtered ? '철자를 바꾸거나 거르기를 풀어 보세요. 독일어와 뜻 모두 찾아요.' : '단어를 넣으면 여기에 보여요.'}</p>
            {filtered && (
              <Button variant="outlined" color="assistive" size="small" onClick={() => set({ ...EMPTY_FILTER, sort: f.sort })}>
                거르기 풀기
              </Button>
            )}
          </div>
        ) : (
          <>
            <ul className="wd-list">
              {fresh.items.map((it) => (
                <li key={it.word.id}>
                  <a className={'wd-row' + (it.word.image ? ' has-img' : '')} {...linkTo('/word/' + it.word.id)}>
                    {it.word.image && <Thumb id={it.word.id} />}
                    <div className="wd-mid">
                      <Lemma word={it.word} className="wd-w" />
                      <div className="wd-m">{it.word.gloss_ko ?? '뜻 준비 중'}</div>
                    </div>
                    <Pill item={it} />
                  </a>
                </li>
              ))}
            </ul>
            {fresh.items.length < fresh.total && (
              <Button variant="outlined" color="assistive" fullWidth loading={loading} onClick={() => setPager({ key, page: page + 1 })}>
                더 보기 · {num(fresh.total - fresh.items.length)}개 남음
              </Button>
            )}
          </>
        )}

        {n > 0 && (
          <div className="wd-cta">
            <Button fullWidth onClick={() => navigate('/drill?' + practiceParams(q, n))}>
              {num(n)}개 연습
            </Button>
          </div>
        )}
      </main>

      <BottomSheet open={sheet !== null} onClose={() => setSheet(null)} title={sheet ? SHEET_TITLE[sheet] : ''}>
        {sheet && (
          <ul className="wd-opts" role="radiogroup" aria-label={SHEET_TITLE[sheet]}>
            {OPTS[sheet].map(([v, label]) => {
              const on = (f[sheet] as string) === v
              return (
                <li key={v}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={'wd-opt' + (on ? ' on' : '')}
                    onClick={() => {
                      set({ [sheet]: v } as Partial<WordsFilter>)
                      setSheet(null)
                    }}
                  >
                    {label as ReactNode}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </BottomSheet>
      <AddWord key={add + '|' + url} open={addOpen} onClose={() => setAddOpen(false)} initialWord={add} initialUrl={url} />
    </>
  )
}

/** 그림이 있는 단어만 쓰는 작은 그림. 못 받으면 칸째 감춘다(머리글자 칸 없음) */
function Thumb({ id }: { id: string }) {
  const [broken, setBroken] = useState(false)
  if (broken) return null
  return <img className="wd-th" src={imgSrc(id)} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />
}

/** 눈에 띌 때만: 제외 · 자주 틀림 · 오늘 복습 */
function Pill({ item }: { item: DeckItem }) {
  const { card } = item
  if (card.suspended) return <ContentBadge size="xsmall" variant="outlined" color="neutral">제외</ContentBadge>
  if (card.lapses >= 2)
    return (
      <ContentBadge size="xsmall" variant="outlined" color="accent" accentColor="semantic.foreground.negative.primary">
        자주 틀림
      </ContentBadge>
    )
  if (card.state !== 0 && dayDiff(card.due) <= 0)
    return (
      <ContentBadge size="xsmall" variant="solid" color="accent" accentColor="semantic.foreground.brand.primary">
        오늘 복습
      </ContentBadge>
    )
  return null
}
