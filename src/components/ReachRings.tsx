import type { CSSProperties } from 'react'
import { CATEGORY_META } from '../lib/categories'
import type { Category } from '../lib/types'

/** 到達レンジのスケール範囲（BACKLOG-2 D8） */
export const REACH_MIN_SCALE = 0.55
export const REACH_MAX_SCALE = 1

export function reachScale(index: number, max: number): number {
  return REACH_MIN_SCALE + ((REACH_MAX_SCALE - REACH_MIN_SCALE) * index) / Math.max(1, max)
}

/**
 * 到達レンジの同心円イラスト（240px, DESIGN §3.1 / BACKLOG-2 D8）。
 * 選択時間に比例して 0.55〜1.0 に拡縮。円上には実際の候補にあるカテゴリ（最大 6）をポップインで出し、
 * 絵文字は逆スケールで常に 22px に保つ。
 */
export function ReachRings({ index, max, categories }: { index: number; max: number; categories: readonly Category[] }) {
  const scale = reachScale(index, max)
  const cats = categories.slice(0, 6)
  return (
    <div className="reach" aria-hidden="true">
      <div className="reach__rings" style={{ transform: `scale(${scale})`, '--inv': 1 / scale } as CSSProperties}>
        <span className="reach__ring reach__ring--3" />
        <span className="reach__ring reach__ring--2" />
        <span className="reach__ring reach__ring--1" />
        {cats.map((c, i) => {
          const a = ((i / cats.length) * 360 - 70) * (Math.PI / 180)
          const r = i % 2 === 0 ? 46 : 36
          return (
            <span
              key={c}
              className="reach__dot"
              style={{ left: `${50 + r * Math.cos(a)}%`, top: `${50 + r * Math.sin(a)}%`, '--d': `${i * 60}ms` } as CSSProperties}
            >
              {CATEGORY_META[c].emoji}
            </span>
          )
        })}
      </div>
      <span className="reach__bike">🚲</span>
    </div>
  )
}
