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
export const GearIcon = ({ size = 22, className }: P) =>
  svg(
    size,
    className,
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5" />
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
