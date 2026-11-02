// Worty × KRDS 부품(v11). montage 를 걷어내며 화면 코드가 쓰던 이름·속성은 그대로 받는다(옛 화면도 KRDS 로 보이게).
// 새 화면은 아래쪽 「새 부품」(Card · StepIndicator · ProgressBar · BottomSheet · OxBar)을 쓴다.
import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { IconClose, IconSearch } from './icons.tsx'
import './tokens.css'
import './k.css'

const cx = (...a: Array<string | false | null | undefined>) => a.filter(Boolean).join(' ')
type Size = 'xsmall' | 'small' | 'medium' | 'large'

// ───────── 버튼 ─────────
// KRDS 4단계: primary(채움) · secondary(파랑 테두리) · tertiary(회색) · text. montage 의 variant·color 를 여기로 옮긴다
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'solid' | 'outlined' | 'text'
  color?: 'primary' | 'assistive' | 'neutral' | 'accent' | 'negative'
  size?: Size
  fullWidth?: boolean
  loading?: boolean
  leadingContent?: ReactNode
}
export function Button({ variant = 'solid', color = 'primary', size = 'medium', fullWidth, loading, leadingContent, disabled, className, children, type = 'button', ...rest }: BtnProps) {
  const kind = variant === 'text' ? 'text' : variant === 'solid' ? (color === 'negative' ? 'danger' : 'primary') : color === 'primary' || color === 'accent' ? 'secondary' : 'tertiary'
  return (
    <button type={type} className={cx('k-btn', `k-btn-${kind}`, `k-btn-${size}`, fullWidth && 'k-wide', loading && 'k-loading', className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="k-spin" aria-hidden="true" /> : leadingContent}
      <span className="k-btn-label">{children}</span>
    </button>
  )
}

export function IconButton({ variant: _v, size = 'medium', className, children, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: Size }) {
  return (
    <button type={type} className={cx('k-iconbtn', `k-iconbtn-${size}`, className)} {...rest}>
      {children}
    </button>
  )
}

// ───────── 배지 ─────────
export type ThemeColorsToken = string
const ACCENT: Record<string, string> = {
  'semantic.foreground.brand.primary': 'b1',
  'semantic.foreground.accent.violet': 'b2',
  'semantic.foreground.accent.pink': 'c1',
  'semantic.foreground.negative.primary': 'bad',
  'semantic.foreground.positive.primary': 'ok',
}
export function ContentBadge({ size: _s, variant = 'solid', color = 'neutral', accentColor, className, children, ...rest }: {
  size?: Size; variant?: 'solid' | 'outlined'; color?: string; accentColor?: ThemeColorsToken; className?: string; children?: ReactNode
} & Record<string, unknown>) {
  const tone = accentColor ? ACCENT[accentColor] ?? 'info' : color === 'primary' || color === 'accent' ? 'info' : color === 'positive' ? 'ok' : color === 'negative' ? 'bad' : color === 'cautionary' ? 'warn' : 'neutral'
  return (
    <span className={cx('k-badge', `k-badge-${tone}`, variant === 'outlined' && 'k-badge-line', className)} {...rest}>
      {children}
    </span>
  )
}

// ───────── 입력 ─────────
export function TextField({ status = 'normal', className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { status?: 'normal' | 'negative' }) {
  return <input className={cx('k-input', status === 'negative' && 'k-input-bad', className)} aria-invalid={status === 'negative' || undefined} {...rest} />
}

export function SearchField({ size: _s, onReset, value, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: Size; onReset?: () => void }) {
  return (
    <div className={cx('k-search', className)}>
      <IconSearch size={20} className="k-search-ic" />
      <input type="search" value={value} {...rest} />
      {value ? (
        <button type="button" className="k-search-x" aria-label="지우기" onClick={onReset}>
          <IconClose size={18} />
        </button>
      ) : null}
    </div>
  )
}

// ───────── 분할 고르기 ─────────
const SegCtx = createContext<{ value: string; set: (v: string) => void; name: string } | null>(null)
export function SegmentedControl({ value, onValueChange, size: _s, className, children, ...rest }: {
  value: string; onValueChange: (v: string) => void; size?: Size; className?: string; children: ReactNode
} & Record<string, unknown>) {
  const name = useId()
  return (
    <SegCtx.Provider value={{ value, set: onValueChange, name }}>
      <div role="radiogroup" className={cx('k-seg', className)} {...rest}>
        {children}
      </div>
    </SegCtx.Provider>
  )
}
export function SegmentedControlItem({ value, children }: { value: string; children: ReactNode }) {
  const c = useContext(SegCtx)
  const on = c?.value === value
  return (
    <button type="button" role="radio" aria-checked={on} className={cx('k-seg-item', on && 'on')} onClick={() => c?.set(value)}>
      {children}
    </button>
  )
}

// ───────── 칩(태그) ─────────
export function Chip({ size: _s, variant: _v, active, className, children, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { size?: Size; variant?: string; active?: boolean }) {
  return (
    <button type={type} className={cx('k-chip', active && 'on', className)} {...rest}>
      {children}
    </button>
  )
}

// ───────── 토글 ─────────
export function Switch({ checked, onCheckedChange, disabled, className, ...rest }: { checked: boolean; onCheckedChange?: (on: boolean) => void; disabled?: boolean; className?: string } & Record<string, unknown>) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} className={cx('k-switch', checked && 'on', className)} onClick={() => onCheckedChange?.(!checked)} {...rest}>
      <span className="k-switch-dot" />
    </button>
  )
}

// ───────── 자리 표시 ─────────
export function Skeleton({ variant = 'rectangle', width = '100%', height = 16, radius }: { variant?: 'rectangle' | 'text' | 'circle'; width?: number | string; height?: number | string; radius?: number }) {
  return <span className={cx('k-skel', variant === 'circle' && 'k-skel-circle')} style={{ width, height, borderRadius: radius ?? (variant === 'text' ? 6 : 12) }} aria-hidden="true" />
}

// ───────── 위 막대 · 아래 탭 ─────────
export function TopNavigation({ leadingContent, trailingContent, children }: { leadingContent?: ReactNode; trailingContent?: ReactNode; children?: ReactNode }) {
  return (
    <header className="k-top">
      <div className="k-top-side">{leadingContent}</div>
      <h1 className="k-top-title">{children}</h1>
      <div className="k-top-side k-top-end">{trailingContent}</div>
    </header>
  )
}
export function TopNavigationButton({ className, children, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={cx('k-iconbtn k-iconbtn-medium', className)} {...rest}>
      {children}
    </button>
  )
}

const TabCtx = createContext<{ value: string; set: (v: string) => void } | null>(null)
export function BottomNavigation({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: ReactNode }) {
  return (
    <TabCtx.Provider value={{ value, set: onValueChange }}>
      <div className="k-tabbar">{children}</div>
    </TabCtx.Provider>
  )
}
export function BottomNavigationItem({ value, label, icon }: { value: string; label: string; icon: ReactNode }) {
  const c = useContext(TabCtx)
  const on = c?.value === value
  return (
    <button type="button" className={cx('k-tab', on && 'on')} aria-current={on ? 'page' : undefined} onClick={() => c?.set(value)}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

// ───────── 토스트(스낵바) ─────────
type Toast = { id: number; content: ReactNode; variant?: string; icon?: ReactNode }
let toasts: Toast[] = []
let seq = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
const store = {
  add(t: { type?: string; content: ReactNode; variant?: string; icon?: ReactNode }) {
    const id = ++seq
    toasts = [...toasts.slice(-2), { id, content: t.content, variant: t.variant, icon: t.icon }]
    emit()
    setTimeout(() => {
      toasts = toasts.filter((x) => x.id !== id)
      emit()
    }, 3200)
  },
}
/** montage 의 useRegionStore((s) => s.add) 자리 */
export function useRegionStore<T>(pick: (s: typeof store) => T): T {
  return pick(store)
}
function ToastHost() {
  const list = useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => toasts)
  return (
    <div className="k-toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={cx('k-toast', t.variant && `k-toast-${t.variant}`)}>
          {t.icon}
          <span>{t.content}</span>
        </div>
      ))}
    </div>
  )
}
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ToastHost />
    </>
  )
}
export function RegionConfig(_: Record<string, unknown>) {
  return null
}

// ───────── 새 부품(v11 화면) ─────────
export function Card({ className, children, as: As = 'section', ...rest }: { className?: string; children: ReactNode; as?: 'section' | 'div' | 'article' } & Record<string, unknown>) {
  return (
    <As className={cx('k-card', className)} {...rest}>
      {children}
    </As>
  )
}

/** 세션 진행 막대(민트). value 0~1 */
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="k-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={label}>
      <i style={{ width: `${v * 100}%` }} />
    </div>
  )
}

/** 단계 표시(KRDS 단계 표시기). done = 끝난 단계 수, current = 지금 단계 번호(0부터) */
export function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="k-steps">
      {steps.map((s, i) => (
        <li key={s} className={cx(i < current && 'done', i === current && 'on')} aria-current={i === current ? 'step' : undefined}>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  )
}

/** 바텀시트(KRDS 모바일). 열려 있으면 바깥 누르기·Esc 로 닫힘 */
export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', k)
    ref.current?.focus()
    return () => document.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="k-sheet-wrap" onClick={onClose}>
      <div className="k-sheet" role="dialog" aria-modal="true" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <span className="k-sheet-grip" aria-hidden="true" />
        {title ? <div className="k-sheet-title">{title}</div> : null}
        {children}
      </div>
    </div>
  )
}

/** X · O 채점 버튼 묶음(v11 R2 결정). 낭독 이름은 「틀림 · 맞힘」 */
export function OxBar({ onX, onO, disabled }: { onX: () => void; onO: () => void; disabled?: boolean }) {
  return (
    <div className="k-ox">
      <button type="button" className="k-ox-x" aria-label="틀림" disabled={disabled} onClick={onX}>
        X
      </button>
      <button type="button" className="k-ox-o" aria-label="맞힘" disabled={disabled} onClick={onO}>
        O
      </button>
    </div>
  )
}

/** 접었다 펴기 */
export function useToggle(initial = false) {
  const [on, set] = useState(initial)
  return [on, () => set((x) => !x), set] as const
}
