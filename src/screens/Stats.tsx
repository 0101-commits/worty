// 기록(v11): 이번 주 한 줄 요약 → 이달 달력 → 자주 틀린 단어 → 복습 예정 → 진도
import { Button, Card, ProgressBar, Skeleton } from '../k/index.tsx'
import type { RecordsResponse } from '../../shared/api.ts'
import { api } from '../api.ts'
import { fmtDay, num } from '../format.ts'
import { useAsync } from '../hooks.ts'
import { linkTo, navigate } from '../router.ts'
import { EMPTY_FILTER, practiceParams } from '../wordsFilter.ts'
import { ErrorBox, LEVELS, LevelBadge, Lemma, Top } from '../ui.tsx'
import './stats.css'

export default function Stats() {
  const r = useAsync(() => api.records(), [])
  const d = r.data
  return (
    <>
      <Top title="기록" actions />
      <main className="page st-page">
        {r.error ? (
          <ErrorBox error={r.error} onRetry={r.reload} />
        ) : !d ? (
          <>
            <Skeleton variant="text" width="70%" height={28} />
            <Skeleton variant="rectangle" width="100%" height={200} radius={12} />
            <Skeleton variant="rectangle" width="100%" height={160} radius={12} />
          </>
        ) : (
          <Body d={d} />
        )}
      </main>
    </>
  )
}

function summary(w: RecordsResponse['week']): string {
  if (w.reviews === 0) return '이번 주는 아직 기록이 없어요'
  return `이번 주 ${w.days}일 · ${num(w.reviews)}장 · 정답률 ${Math.round((w.correct / w.reviews) * 100)}%`
}

function Body({ d }: { d: RecordsResponse }) {
  const monthNo = Number(d.month.month.slice(5))
  return (
    <>
      <h2 className="st-sum">{summary(d.week)}</h2>

      <Card>
        <div className="st-row-h">
          <h3>{monthNo}월</h3>
          <span className="small muted">{num(d.month.days.reduce((a, x) => a + x.count, 0))}장</span>
        </div>
        <Calendar days={d.month.days} />
      </Card>

      <Card>
        <h3>자주 틀린 단어</h3>
        {d.weak.length === 0 ? (
          <p className="small muted">아직 자주 틀린 단어가 없어요.</p>
        ) : (
          <>
            <ul className="st-weak">
              {d.weak.map((w) => (
                <li key={w.id}>
                  <a className="st-weak-row" {...linkTo('/word/' + w.id)}>
                    <span className="st-weak-w">
                      <Lemma word={w} />
                      <span className="st-weak-m">{w.gloss_ko}</span>
                    </span>
                    <b className="st-x">X {w.x}</b>
                  </a>
                </li>
              ))}
            </ul>
            <Button variant="outlined" color="primary" fullWidth onClick={() => navigate('/drill?' + practiceParams({ ...EMPTY_FILTER, weak: true }, 10))}>
              모아서 연습
            </Button>
          </>
        )}
      </Card>

      <Card>
        <h3>복습 예정</h3>
        <Forecast days={d.forecast} />
      </Card>

      <Card>
        <h3>진도</h3>
        <div className="st-prog">
          {LEVELS.map((lv) => {
            const p = d.progress[lv]
            return (
              <div className="st-prog-row" key={lv}>
                <LevelBadge level={lv} />
                <ProgressBar value={p.total ? p.learned / p.total : 0} label={`${lv} 진도`} />
                <span className="st-prog-n num">{num(p.learned)} / {num(p.total)}</span>
              </div>
            )
          })}
        </div>
      </Card>
    </>
  )
}

const DOW = ['월', '화', '수', '목', '금', '토', '일']

/** 이번 달 달력(월요일 시작). 칸 색은 이달 최댓값 대비 4단계 민트 */
function Calendar({ days }: { days: RecordsResponse['month']['days'] }) {
  if (!days.length) return null
  const max = Math.max(1, ...days.map((x) => x.count))
  const pad = (new Date(days[0].day + 'T00:00:00Z').getUTCDay() + 6) % 7
  const lv = (c: number) => (c === 0 ? '' : c <= max * 0.25 ? 'l1' : c <= max * 0.5 ? 'l2' : c <= max * 0.75 ? 'l3' : 'l4')
  return (
    <div className="st-cal" role="img" aria-label="이번 달 채점 기록">
      {DOW.map((x) => <span key={x} className="st-dow">{x}</span>)}
      {Array.from({ length: pad }, (_, i) => <i key={'p' + i} className="st-pad" />)}
      {days.map((x) => (
        <i key={x.day} className={lv(x.count)} title={`${fmtDay(x.day)} · ${x.count}장`}>{Number(x.day.slice(8))}</i>
      ))}
    </div>
  )
}

/** 앞으로 7일 막대. 오늘 · 내일 · 모레 · 그 뒤는 날짜 */
function Forecast({ days }: { days: RecordsResponse['forecast'] }) {
  const max = Math.max(1, ...days.map((x) => x.count))
  const name = (i: number, day: string) => (i === 0 ? '오늘' : i === 1 ? '내일' : i === 2 ? '모레' : fmtDay(day))
  return (
    <div className="st-fc" role="img" aria-label={days.map((x, i) => `${name(i, x.day)} ${x.count}장`).join(', ')}>
      {days.map((x, i) => (
        <div className="st-fc-col" key={x.day}>
          <b className="num">{x.count}</b>
          <span className="st-fc-bar">{x.count > 0 && <i style={{ height: `${(x.count / max) * 100}%` }} />}</span>
          <span className="st-fc-d">{name(i, x.day)}</span>
        </div>
      ))}
    </div>
  )
}
