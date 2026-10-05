import { CLIMB_PENALTY_MIN_PER_10M, roadKmEstimate } from './reach'
import type { ElevationSummary } from './types'

export type TripMode = 'oneway' | 'round'

/** tripEstimate の入力: 一覧の Place に、詳細で取れた経路距離（あれば）を足したもの */
export interface TripInput {
  /** 出発地からの直線距離 (km) */
  distanceKm: number
  /** 経路（OSRM）の片道距離 (km)。取れていなければ undefined（直線 × 迂回係数で推定） */
  routeKm?: number
  elevation?: ElevationSummary | null
}

export interface TripEstimate {
  mode: TripMode
  /** 片道の走行距離 (km, 0.1km 単位) */
  oneWayKm: number
  /** mode の走行距離 (km)（往復なら片道 × 2） */
  km: number
  /** mode の走行時間の目安 (分)。5 分単位（15 分未満は 1 分単位）に丸め済み */
  minutes: number
  /** 丸める前の走行時間 (分) */
  rawMinutes: number
  /** mode の上り (m)。往復 = 行きの上り + 帰りの上り、片道 = 行きの上り。標高が無ければ null */
  gainM: number | null
  /** G = max(行きの上り, 帰りの上り) (m)。バッジ・ラベル判定の値 */
  climbM: number | null
  /** true = 経路距離ベース（false = 直線 × 迂回係数の推定） */
  routed: boolean
}

/**
 * 走行時間の丸め（BACKLOG-2 D2）: 5 分単位。15 分未満のときだけ 1 分単位（最低 1 分）。
 */
export function roundTripMinutes(min: number): number {
  if (!(min > 0)) return 0
  if (min < 15) return Math.max(1, Math.round(min))
  return Math.round(min / 5) * 5
}

/**
 * 距離・時間・上りの計算を 1 か所に（BACKLOG-2 D2/C13）。カード・ガチャ・詳細・出発記録はすべてこれを使う。
 * - 片道距離: 経路距離があればそれ、無ければ直線 × 迂回係数
 * - 時間: 距離 ÷ 速度 + 上りペナルティ（10m ごとに +0.5 分）。滞在時間は含まない
 */
export function tripEstimate(place: TripInput, mode: TripMode, speedKmh: number): TripEstimate {
  const routed = typeof place.routeKm === 'number' && place.routeKm > 0
  // 表示は 0.1km 単位。往復は「丸めた片道 × 2」にして、片道 4.9km / 往復 9.7km のような食い違いを出さない
  const oneWayKm = Math.round((routed ? place.routeKm! : roadKmEstimate(place.distanceKm)) * 10) / 10
  const round = mode === 'round'
  const km = round ? oneWayKm * 2 : oneWayKm
  const e = place.elevation ?? null
  const gainM = e ? (round ? e.gainRoundTripM : e.gainOneWayM) : null
  const ride = speedKmh > 0 ? (km / speedKmh) * 60 : 0
  const rawMinutes = ride + ((gainM ?? 0) / 10) * CLIMB_PENALTY_MIN_PER_10M
  return {
    mode,
    oneWayKm,
    km,
    minutes: roundTripMinutes(rawMinutes),
    rawMinutes,
    gainM: gainM === null ? null : Math.round(gainM),
    climbM: e ? Math.round(e.climbM) : null,
    routed,
  }
}
