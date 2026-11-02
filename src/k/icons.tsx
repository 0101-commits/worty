// 선 아이콘(24 격자, 1.8 선). montage 아이콘 이름을 그대로 받아 화면 코드를 덜 고친다. 꾸밈이라 aria-hidden.
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }
function Svg({ size = 24, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  )
}
const fill = (p: P) => ({ ...p, fill: 'currentColor', stroke: 'none' })

export const IconHome = (p: P) => <Svg {...p}><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" /></Svg>
export const IconHomeFill = (p: P) => <Svg {...fill(p)}><path d="M11.4 3.2a1 1 0 0 1 1.2 0l8 6.5c.25.2.4.5.4.8V20a2 2 0 0 1-2 2h-4.5a1 1 0 0 1-1-1v-5h-3v5a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2v-9.5c0-.3.15-.6.4-.8z" /></Svg>
export const IconBook = (p: P) => <Svg {...p}><path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h10" /></Svg>
export const IconBookFill = (p: P) => <Svg {...fill(p)}><path d="M4 5a2 2 0 0 1 2-2h9a4 4 0 0 1 4 4v13a1 1 0 0 1-1 1H8a4 4 0 0 1-4-4zm4 8a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h9v-6z" /></Svg>
export const IconRead = (p: P) => <Svg {...p}><path d="M3 5.5C5.5 4.5 8.5 4.5 12 6.5c3.5-2 6.5-2 9-1V19c-2.5-1-5.5-1-9 1-3.5-2-6.5-2-9-1z" /><path d="M12 6.5V20" /></Svg>
export const IconReadFill = (p: P) => <Svg {...fill(p)}><path d="M2 5.5c0-.4.24-.76.6-.92C5.4 3.4 8.6 3.5 11 4.7V20c-2.6-1.3-5.5-1.4-7.7-.5A1 1 0 0 1 2 18.6zM13 4.7c2.4-1.2 5.6-1.3 8.4-.12.36.16.6.52.6.92v13.1a1 1 0 0 1-1.3.92c-2.2-.9-5.1-.8-7.7.5z" /></Svg>
export const IconCalendar = (p: P) => <Svg {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Svg>
export const IconCalendarFill = (p: P) => <Svg {...fill(p)}><path d="M8 2a1 1 0 0 1 1 1v1h6V3a1 1 0 1 1 2 0v1h1.5A2.5 2.5 0 0 1 21 6.5V9H3V6.5A2.5 2.5 0 0 1 5.5 4H7V3a1 1 0 0 1 1-1zM3 11h18v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 19.5z" /></Svg>
export const IconBell = (p: P) => <Svg {...p}><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></Svg>
export const IconSetting = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.54V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.54 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.54-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.54-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.54V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.54 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.54 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.54 1z" /></Svg>
export const IconChevronLeft = (p: P) => <Svg {...p}><path d="M15 5l-7 7 7 7" /></Svg>
export const IconChevronRight = (p: P) => <Svg {...p}><path d="M9 5l7 7-7 7" /></Svg>
export const IconChevronDown = (p: P) => <Svg {...p}><path d="M5 9l7 7 7-7" /></Svg>
export const IconMinus = (p: P) => <Svg {...p}><path d="M5 12h14" /></Svg>
export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
export const IconClose = (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>
export const IconCircle = (p: P) => <Svg {...p} strokeWidth={2.4}><circle cx="12" cy="12" r="7.5" /></Svg>
export const IconCheck = (p: P) => <Svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>
export const IconSearch = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></Svg>
export const IconPlay = (p: P) => <Svg {...fill(p)}><path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z" /></Svg>
export const IconMore = (p: P) => <Svg {...fill(p)}><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></Svg>
export const IconLink = (p: P) => <Svg {...p}><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></Svg>
export const IconSend = (p: P) => <Svg {...p}><path d="M21 3 10 14" /><path d="M21 3l-7 18-4-7-7-4z" /></Svg>
export const IconFlipBackward = (p: P) => <Svg {...p}><path d="M4 8h11a5 5 0 0 1 0 10H8" /><path d="M8 4 4 8l4 4" /></Svg>
