import type { ElevationLabel } from '../lib/types'

type P = { size?: number; className?: string }
const svg = (size: number, className: string | undefined, children: React.ReactNode, viewBox = '0 0 24 24') => (
  <svg
    width={size}
    height={size}
    viewBox={viewBox}
    className={className}
    aria-hidden="true"
    focusable="false"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
)

export const ChevronLeft = ({ size = 24, className }: P) => svg(size, className, <path d="M15 5l-7 7 7 7" />)
export const ChevronRight = ({ size = 16, className }: P) => svg(size, className, <path d="M9 5l7 7-7 7" />)
export const CloseIcon = ({ size = 22, className }: P) => svg(size, className, <path d="M6 6l12 12M18 6L6 18" />)
/** 歯車（設定, BACKLOG-2 D5）。外周の歯 8 枚＋中心の穴 */
export const GearIcon = ({ size = 22, className }: P) =>
  svg(
    size,
    className,
    <>
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        strokeWidth={1.9}
      />
    </>,
  )
export const HeartIcon = ({ size = 22, className, filled }: P & { filled?: boolean }) =>
  svg(size, className, <path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" fill={filled ? 'currentColor' : 'none'} />)
export const PinIcon = ({ size = 18, className }: P) =>
  svg(
    size,
    className,
    <>
      <path d="M12 21s-6-5.6-6-11a6 6 0 0112 0c0 5.4-6 11-6 11z" />
      <circle cx="12" cy="10" r="2.2" />
    </>,
  )
export const CheckIcon = ({ size = 18, className }: P) => svg(size, className, <path d="M5 12.5l4.5 4.5L19 7.5" />)

/** 高低差の形状アイコン（色に頼らない区別, DESIGN §4） */
export function ElevationIcon({ label, size = 16 }: { label: ElevationLabel; size?: number }) {
  if (label === 'hilly') return svg(size, undefined, <path d="M2 19l5.5-10 3.5 6 3-5 8 9z" fill="currentColor" stroke="none" />)
  if (label === 'rolling') return svg(size, undefined, <path d="M2 14c2.5-4 5-4 7.5 0s5 4 7.5 0 3.5-3 5-2" />)
  return svg(size, undefined, <path d="M3 12h18" strokeWidth={3} />)
}
