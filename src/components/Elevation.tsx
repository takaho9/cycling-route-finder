import { useId, useMemo, useRef, useState } from 'react'
import type { ElevationLabel, ElevationSummary } from '../lib/types'
import { ElevationIcon } from './Icons'

export const ELEVATION_TEXT: Record<ElevationLabel, { short: string; long: string; sub: string; emoji: string }> = {
  flat: { short: '平坦', long: 'フラット', sub: 'のんびり平坦', emoji: '🟢' },
  rolling: { short: 'ゆる', long: 'ゆるアップダウン', sub: 'ほどよくアップダウン', emoji: '🟡' },
  hilly: { short: 'ヒル', long: 'ヒルクライム', sub: '登りごたえあり', emoji: '🔴' },
}

/** 縦レンジの最小幅 (m)。これより小さい起伏を誇張しない（BACKLOG-2 D1） */
export const MIN_ELEV_SPAN_M = 60

/**
 * 標高グラフの縦レンジ（D1）: span = max(実レンジ × 1.15, 60m) を中央寄せし、10m 単位で外側に丸める。
 * 標高がすべて 0m 以上なら、下端が 0 を割らないように上へずらす。
 */
export function elevationAxis(profile: readonly number[]): { lo: number; hi: number } {
  if (profile.length === 0) return { lo: 0, hi: MIN_ELEV_SPAN_M }
  const min = Math.min(...profile)
  const max = Math.max(...profile)
  const span = Math.max((max - min) * 1.15, MIN_ELEV_SPAN_M)
  const mid = (max + min) / 2
  let lo = Math.floor((mid - span / 2) / 10) * 10
  let hi = Math.ceil((mid + span / 2) / 10) * 10
  if (min >= 0 && lo < 0) {
    hi -= lo
    lo = 0
  }
  return { lo, hi }
}

/** 実際の高低差（最高 − 最低, m） */
export const reliefM = (profile: readonly number[]) => (profile.length ? Math.round(Math.max(...profile) - Math.min(...profile)) : 0)

/**
 * 高低差バッジ（DESIGN §4, BACKLOG-2 D11）: 淡い背景＋濃い文字、形状アイコン＋テキストの 3 重表現。
 * 一覧の直線推定は数字の前に「≈」。
 */
export function ElevationBadge({ summary, state }: { summary?: ElevationSummary; state: 'loading' | 'ready' | 'none' }) {
  if (state === 'loading') return <span className="elev-badge elev-badge--loading">高低差 — m</span>
  if (!summary) return <span className="elev-badge elev-badge--none">高低差 —</span>
  const t = ELEVATION_TEXT[summary.label]
  const g = Math.round(summary.climbM)
  return (
    <span
      className={`elev-badge elev-badge--${summary.label}`}
      title={summary.estimated ? '直線で推定した高低差' : '経路に沿った高低差'}
      aria-label={`高低差 ${summary.estimated ? '約' : ''}${g}m ${t.short}${summary.estimated ? '（推定）' : ''}`}
    >
      <ElevationIcon label={summary.label} />
      <span className="num">
        {summary.estimated && <span className="elev-badge__est">≈</span>}+{g}m
      </span>
      <span>{t.short}</span>
    </span>
  )
}

function toPoints(profile: readonly number[], km: readonly number[], xMax: number, axis: { lo: number; hi: number }, w: number, h: number, pad = 2) {
  const span = axis.hi - axis.lo || 1
  const total = xMax || km[km.length - 1] || 1
  return profile.map((e, i) => [(km[i] / total) * w, h - pad - ((e - axis.lo) / span) * (h - pad * 2)] as const)
}

/** ミニ標高グラフ（カード, 96×28）。詳細と同じ縦レンジ規則（最小 60m）で、平坦な道は平らに見せる */
export function MiniElevation({ summary, width = 96, height = 28 }: { summary: ElevationSummary; width?: number; height?: number }) {
  const pts = useMemo(
    () => toPoints(summary.profile, summary.profileKm, summary.distanceKm, elevationAxis(summary.profile), width, height),
    [summary, width, height],
  )
  if (pts.length < 2) return null
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return (
    <svg className={`mini-elev mini-elev--${summary.label}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polygon points={`${pts[0][0].toFixed(1)},${height} ${line} ${pts[pts.length - 1][0].toFixed(1)},${height}`} className="mini-elev__area" />
      <polyline points={line} className="mini-elev__line" pathLength={1} />
    </svg>
  )
}

/**
 * 詳細の標高プロファイル（高さ 120px, DESIGN §4 / BACKLOG-2 D1）。
 * - 縦レンジは elevationAxis（最小 60m・中央寄せ・10m 単位）。軸ラベルは軸の端の値、補助線は中央に 1 本
 * - 右上に「高低差 Xm」
 * - 往復モードは折り返して横幅を往復分に。折り返し線は距離から計算した位置
 * - タップ/ドラッグで縦カーソルと「1.8km地点 · 42m」
 */
export function ElevationProfile({ summary, roundTrip, straight }: { summary: ElevationSummary; roundTrip: boolean; straight: boolean }) {
  const gid = useId()
  const w = 320
  const h = 120
  const ref = useRef<SVGSVGElement>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const xMax = roundTrip ? summary.distanceKm * 2 : summary.distanceKm
  const { profile, km } = useMemo(() => {
    if (!roundTrip) return { profile: summary.profile, km: summary.profileKm }
    const total = summary.distanceKm
    const backP = [...summary.profile].reverse().slice(1)
    const backK = [...summary.profileKm].reverse().slice(1).map((k) => total + (total - k))
    return { profile: [...summary.profile, ...backP], km: [...summary.profileKm, ...backK] }
  }, [summary, roundTrip])
  const axis = useMemo(() => elevationAxis(summary.profile), [summary])
  const pts = useMemo(() => toPoints(profile, km, xMax, axis, w, h, 0), [profile, km, xMax, axis])
  if (pts.length < 2) return null
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const relief = reliefM(summary.profile)
  const turnX = roundTrip && xMax > 0 ? (summary.distanceKm / xMax) * w : null
  const midY = h / 2

  const onPointer = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    const x = Math.min(Math.max(0, e.clientX - r.left), r.width) / r.width
    const target = x * xMax
    let best = 0
    km.forEach((k, i) => {
      if (Math.abs(k - target) < Math.abs(km[best] - target)) best = i
    })
    setCursor(best)
  }

  return (
    <figure className={`elev-profile elev-profile--${summary.label}`}>
      <div className="elev-profile__axis num" aria-hidden="true">
        <span>{axis.hi}m</span>
        <span>{axis.lo}m</span>
      </div>
      <div className="elev-profile__plot">
        <svg
          ref={ref}
          className="elev-profile__svg"
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`標高プロファイル。高低差${relief}m、最低${Math.round(Math.min(...summary.profile))}m、最高${Math.round(Math.max(...summary.profile))}m`}
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
          <line x1={0} x2={w} y1={midY} y2={midY} className="elev-profile__guide" vectorEffect="non-scaling-stroke" />
          <polygon points={`${pts[0][0].toFixed(1)},${h} ${line} ${pts[pts.length - 1][0].toFixed(1)},${h}`} fill={`url(#${gid})`} />
          <polyline points={line} className="elev-profile__line" pathLength={1} vectorEffect="non-scaling-stroke" />
          {turnX !== null && <line x1={turnX} x2={turnX} y1={0} y2={h} className="elev-profile__turn" vectorEffect="non-scaling-stroke" />}
          {cursor !== null && (
            <line x1={pts[cursor][0]} x2={pts[cursor][0]} y1={0} y2={h} className="elev-profile__cursor" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        <span className="elev-profile__relief">
          高低差 <span className="num">{relief}m</span>
        </span>
        {cursor !== null && (
          <div className="elev-profile__tip num" style={{ left: `${(pts[cursor][0] / w) * 100}%` }}>
            {km[cursor].toFixed(1)}km地点 · {Math.round(profile[cursor])}m
          </div>
        )}
      </div>
      <figcaption className="elev-profile__x">
        <span>🏠 出発</span>
        {turnX !== null && (
          <span className="elev-profile__turn-label" style={{ left: `${(turnX / w) * 100}%` }}>
            📍 折り返し
          </span>
        )}
        <span>{roundTrip ? '🏠 帰着' : '📍 到着'}</span>
      </figcaption>
      {straight && <p className="elev-profile__note">※ 直線で推定</p>}
    </figure>
  )
}
