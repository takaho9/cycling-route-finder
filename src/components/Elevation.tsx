import { useId, useMemo, useRef, useState } from 'react'
import type { ElevationLabel, ElevationSummary } from '../lib/types'
import { ElevationIcon } from './Icons'

export const ELEVATION_TEXT: Record<ElevationLabel, { short: string; long: string; sub: string; emoji: string }> = {
  flat: { short: '平坦', long: 'フラット', sub: 'のんびり平坦', emoji: '🟢' },
  rolling: { short: 'ゆる', long: 'ゆるアップダウン', sub: 'ほどよくアップダウン', emoji: '🟡' },
  hilly: { short: 'ヒル', long: 'ヒルクライム', sub: '登りごたえあり', emoji: '🔴' },
}

/** 高低差バッジ: 色＋形状アイコン＋テキストの 3 重表現（DESIGN §4） */
export function ElevationBadge({
  summary,
  state,
  roundTrip = false,
}: {
  summary?: ElevationSummary
  state: 'loading' | 'ready' | 'none'
  roundTrip?: boolean
}) {
  if (state === 'loading') return <span className="elev-badge elev-badge--loading">高低差 — m</span>
  if (!summary) return <span className="elev-badge elev-badge--none">高低差 —</span>
  const t = ELEVATION_TEXT[summary.label]
  const g = Math.round(roundTrip ? summary.gainRoundTripM : summary.climbM)
  return (
    <span
      className={`elev-badge elev-badge--${summary.label}`}
      title={summary.estimated ? '直線で推定した高低差' : '経路に沿った高低差'}
    >
      <ElevationIcon label={summary.label} />
      <span className="num">+{g}m</span>
      <span>{t.short}</span>
      {summary.estimated && <span className="elev-badge__est">推定</span>}
    </span>
  )
}

function toPoints(profile: readonly number[], km: readonly number[], w: number, h: number, pad = 2) {
  const min = Math.min(...profile)
  const max = Math.max(...profile)
  const span = Math.max(max - min, 10) // 10m 未満の差は平らに見せる
  const total = km[km.length - 1] || 1
  return profile.map((e, i) => [(km[i] / total) * w, h - pad - ((e - min) / span) * (h - pad * 2)] as const)
}

/** ミニ標高グラフ（カード下段, 96×28） */
export function MiniElevation({ summary }: { summary: ElevationSummary }) {
  const w = 96
  const h = 28
  const pts = useMemo(() => toPoints(summary.profile, summary.profileKm, w, h), [summary])
  if (pts.length < 2) return null
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return (
    <svg className={`mini-elev mini-elev--${summary.label}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polygon points={`0,${h} ${line} ${w},${h}`} className="mini-elev__area" />
      <polyline points={line} className="mini-elev__line" pathLength={1} />
    </svg>
  )
}

/**
 * 詳細の標高プロファイル（高さ 120px）。往復モードでは折り返して横幅を往復分に。
 * タップ/ドラッグで縦カーソルと「1.8km地点 · 42m」。
 */
export function ElevationProfile({
  summary,
  roundTrip,
  straight,
}: {
  summary: ElevationSummary
  roundTrip: boolean
  straight: boolean
}) {
  const gid = useId()
  const w = 320
  const h = 120
  const ref = useRef<SVGSVGElement>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const { profile, km } = useMemo(() => {
    if (!roundTrip) return { profile: summary.profile, km: summary.profileKm }
    const total = summary.distanceKm
    const backP = [...summary.profile].reverse().slice(1)
    const backK = [...summary.profileKm].reverse().slice(1).map((k) => total + (total - k))
    return { profile: [...summary.profile, ...backP], km: [...summary.profileKm, ...backK] }
  }, [summary, roundTrip])
  const pts = useMemo(() => toPoints(profile, km, w, h - 8, 6), [profile, km])
  if (pts.length < 2) return null
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const min = Math.round(Math.min(...profile))
  const max = Math.round(Math.max(...profile))
  const totalKm = km[km.length - 1] || 1

  const onPointer = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    const x = Math.min(Math.max(0, e.clientX - r.left), r.width) / r.width
    const target = x * totalKm
    let best = 0
    km.forEach((k, i) => {
      if (Math.abs(k - target) < Math.abs(km[best] - target)) best = i
    })
    setCursor(best)
  }

  return (
    <figure className={`elev-profile elev-profile--${summary.label}`}>
      <div className="elev-profile__axis num" aria-hidden="true">
        <span>{max}m</span>
        <span>{min}m</span>
      </div>
      <svg
        ref={ref}
        className="elev-profile__svg"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`標高プロファイル。最低${min}m、最高${max}m`}
        onPointerDown={onPointer}
        onPointerMove={(e) => e.buttons && onPointer(e)}
        onPointerLeave={() => setCursor(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${h} ${line} ${w},${h}`} fill={`url(#${gid})`} />
        <polyline points={line} className="elev-profile__line" pathLength={1} vectorEffect="non-scaling-stroke" />
        {roundTrip && <line x1={w / 2} x2={w / 2} y1={0} y2={h} className="elev-profile__turn" vectorEffect="non-scaling-stroke" />}
        {cursor !== null && (
          <line x1={pts[cursor][0]} x2={pts[cursor][0]} y1={0} y2={h} className="elev-profile__cursor" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {cursor !== null && (
        <div className="elev-profile__tip num" style={{ left: `${(pts[cursor][0] / w) * 100}%` }}>
          {km[cursor].toFixed(1)}km地点 · {Math.round(profile[cursor])}m
        </div>
      )}
      <figcaption className="elev-profile__x">
        <span>🏠 出発</span>
        {roundTrip && <span>📍 折り返し</span>}
        <span>{roundTrip ? '🏠 帰着' : '📍 到着'}</span>
      </figcaption>
      {straight && <p className="elev-profile__note">※ 直線で推定</p>}
    </figure>
  )
}
