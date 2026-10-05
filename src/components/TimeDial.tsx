import { useCallback, useId, useRef } from 'react'
import { ROUND_TRIP_MINUTES } from '../lib/reach'

const W = 340
const H = 196
const CX = W / 2
const CY = 178
const R = 142
/** 各目盛りの角度（度, 左 165° → 右 15°, 30° 間隔） */
export const DIAL_ANGLES = ROUND_TRIP_MINUTES.map((_, i) => 165 - i * 30)
const LABELS = ['15', '30', '45', '1h', '1h15', '1h30']

const pt = (deg: number, r = R) => [CX + r * Math.cos((deg * Math.PI) / 180), CY - r * Math.sin((deg * Math.PI) / 180)] as const
const arc = (from: number, to: number) => {
  const [x1, y1] = pt(from)
  const [x2, y2] = pt(to)
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

/** 角度 (度, 数学座標) → 最寄りの目盛りインデックス */
export function angleToIndex(deg: number): number {
  const d = Math.max(0, Math.min(180, deg))
  const i = Math.round((165 - d) / 30)
  return Math.max(0, Math.min(ROUND_TRIP_MINUTES.length - 1, i))
}

export function formatDial(min: number): { value: string; unit: string } {
  if (min < 60) return { value: String(min), unit: '分' }
  return { value: `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`, unit: '時間' }
}

/**
 * 半円タイムダイヤル（DESIGN §3.1）。Pointer Events で角度→目盛りにスナップ、←→キーで 1 段移動。
 */
export function TimeDial({
  index,
  onChange,
  valueText,
}: {
  index: number
  onChange: (index: number) => void
  valueText: string
}) {
  const ref = useRef<SVGSVGElement>(null)
  const gradId = useId()
  const dragging = useRef(false)
  const minutes = ROUND_TRIP_MINUTES[index]
  const { value, unit } = formatDial(minutes)

  const setFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const r = ref.current?.getBoundingClientRect()
      if (!r || r.width === 0) return
      const x = ((clientX - r.left) / r.width) * W
      const y = ((clientY - r.top) / r.height) * H
      let deg = (Math.atan2(CY - y, x - CX) * 180) / Math.PI
      if (deg < -90) deg = 180 // 左下 → 左端
      else if (deg < 0) deg = 0 // 右下 → 右端
      const i = angleToIndex(deg)
      if (i !== index) onChange(i)
    },
    [index, onChange],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = ROUND_TRIP_MINUTES.length - 1
    let next = index
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(last, index + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, index - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = last
    else return
    e.preventDefault()
    if (next !== index) onChange(next)
  }

  const [kx, ky] = pt(DIAL_ANGLES[index])
  return (
    <div
      className="dial"
      role="slider"
      tabIndex={0}
      aria-label="往復の時間"
      aria-valuemin={0}
      aria-valuemax={ROUND_TRIP_MINUTES.length - 1}
      aria-valuenow={index}
      aria-valuetext={valueText}
      onKeyDown={onKeyDown}
    >
      <svg
        ref={ref}
        className="dial__svg"
        viewBox={`0 0 ${W} ${H}`}
        onPointerDown={(e) => {
          dragging.current = true
          ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
          setFromPointer(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => dragging.current && setFromPointer(e.clientX, e.clientY)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" className="dial__stop1" />
            <stop offset="0.5" className="dial__stop2" />
            <stop offset="1" className="dial__stop3" />
          </linearGradient>
        </defs>
        <path d={arc(DIAL_ANGLES[0], DIAL_ANGLES[DIAL_ANGLES.length - 1])} className="dial__track" />
        {index > 0 && <path d={arc(DIAL_ANGLES[0], DIAL_ANGLES[index])} className="dial__progress" stroke={`url(#${gradId})`} />}
        {index === 0 && <circle cx={pt(DIAL_ANGLES[0])[0]} cy={pt(DIAL_ANGLES[0])[1]} r={10} className="dial__progress-dot" />}
        {DIAL_ANGLES.map((a, i) => {
          const [x, y] = pt(a)
          const [lx, ly] = pt(a, R - 38)
          return (
            <g key={a}>
              <circle cx={x} cy={y} r={3.5} className={i <= index ? 'dial__tick is-on' : 'dial__tick'} />
              <text x={lx} y={ly} className={`dial__label num${i === index ? ' is-current' : ''}`} textAnchor="middle" dominantBaseline="middle">
                {LABELS[i]}
              </text>
            </g>
          )
        })}
        <circle cx={kx} cy={ky} r={22} className="dial__knob" />
        <text x={kx} y={ky + 1} className="dial__knob-icon" textAnchor="middle" dominantBaseline="middle">
          🚲
        </text>
      </svg>
      <div className="dial__center" aria-hidden="true">
        <span key={minutes} className="dial__value num">
          {value}
        </span>
        <span className="dial__unit">{unit}</span>
      </div>
    </div>
  )
}
