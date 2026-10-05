export type SpeedPresetId = 'relaxed' | 'normal' | 'fast'

export interface SpeedPreset {
  id: SpeedPresetId
  label: string
  kmh: number
}

export const SPEED_PRESETS: Record<SpeedPresetId, SpeedPreset> = {
  relaxed: { id: 'relaxed', label: 'のんびり', kmh: 12 },
  normal: { id: 'normal', label: 'ふつう', kmh: 16 },
  fast: { id: 'fast', label: '速め', kmh: 20 },
}

export const DEFAULT_SPEED_PRESET: SpeedPresetId = 'normal'

/** 往復時間の選択肢 (分) */
export const ROUND_TRIP_MINUTES = [15, 30, 45, 60, 75, 90] as const

/** 直線距離 → 実走距離 の迂回係数 */
export const DETOUR_FACTOR = 1.3

/** 候補にする距離帯: 最大到達距離に対する比率（近すぎる候補は運動にならない） */
export const MIN_REACH_RATIO = 0.7
export const MAX_REACH_RATIO = 1.0

export interface Reach {
  /** 片道の最大到達距離（直線, km） */
  maxKm: number
  /** 候補ドーナツ領域の内径（直線, km） */
  minKm: number
  /** 候補ドーナツ領域の外径（直線, km） */
  bandMaxKm: number
}

/**
 * 往復時間と速度から、片道で到達できる最大直線距離と候補距離帯を計算。
 * 片道直線距離 = 速度 × (T/2) ÷ 迂回係数
 */
export function computeReach(
  roundTripMin: number,
  speedKmh: number,
  detourFactor: number = DETOUR_FACTOR,
): Reach {
  if (!(roundTripMin > 0) || !(speedKmh > 0) || !(detourFactor > 0)) {
    return { maxKm: 0, minKm: 0, bandMaxKm: 0 }
  }
  const maxKm = (speedKmh * (roundTripMin / 60)) / 2 / detourFactor
  return { maxKm, minKm: maxKm * MIN_REACH_RATIO, bandMaxKm: maxKm * MAX_REACH_RATIO }
}

/** 上りペナルティ: 往復の獲得標高 10m ごとに +0.5 分 */
export const CLIMB_PENALTY_MIN_PER_10M = 0.5
/** 経路距離が「走行距離の予算」のこの倍率を超えたら警告 */
export const ROUTE_OVER_BUDGET_RATIO = 1.2

/** 直線距離 → 走行距離の目安 (km) */
export function roadKmEstimate(straightKm: number, detourFactor: number = DETOUR_FACTOR): number {
  return straightKm * detourFactor
}

/**
 * 候補までの往復の走行時間の目安 (分)。滞在時間は含まない。
 * - routed=false（既定）: oneWayKm は直線距離として迂回係数を掛ける
 * - routed=true: oneWayKm は実経路距離（OSRM 等）としてそのまま使う
 * - gainRoundTripM: 往復の獲得標高。10m ごとに +0.5 分
 */
export function estimateRoundTripMin(
  oneWayKm: number,
  speedKmh: number,
  {
    routed = false,
    detourFactor = DETOUR_FACTOR,
    gainRoundTripM = 0,
  }: { routed?: boolean; detourFactor?: number; gainRoundTripM?: number } = {},
): number {
  if (!(speedKmh > 0) || !(oneWayKm >= 0)) return 0
  const roadKm = routed ? oneWayKm : oneWayKm * detourFactor
  const climb = gainRoundTripM > 0 ? (gainRoundTripM / 10) * CLIMB_PENALTY_MIN_PER_10M : 0
  return ((roadKm * 2) / speedKmh) * 60 + climb
}

/** 片道の走行距離の予算 (km) = 速度 × T/2 */
export function roadBudgetKm(roundTripMin: number, speedKmh: number): number {
  return roundTripMin > 0 && speedKmh > 0 ? (speedKmh * roundTripMin) / 120 : 0
}

/** 経路距離が予算 × 1.2 を超えるか */
export function isRouteOverBudget(routeKm: number, roundTripMin: number, speedKmh: number): boolean {
  return routeKm > roadBudgetKm(roundTripMin, speedKmh) * ROUTE_OVER_BUDGET_RATIO
}

/**
 * Overpass に 1 回だけ投げる検索範囲（R6）。どの速度プリセット・時間チップでも
 * クライアント側フィルタで済むよう、最遅×最短の内径 〜 最速×最長の外径 をカバーする。
 */
export function searchBand(): { minKm: number; maxKm: number } {
  const speeds = Object.values(SPEED_PRESETS).map((p) => p.kmh)
  const minT = Math.min(...ROUND_TRIP_MINUTES)
  const maxT = Math.max(...ROUND_TRIP_MINUTES)
  return { minKm: computeReach(minT, Math.min(...speeds)).minKm, maxKm: computeReach(maxT, Math.max(...speeds)).maxKm }
}

/** 「1時間15分」のような日本語表記 */
export function formatMinutesJa(min: number): string {
  const m = Math.round(min)
  if (m < 60) return `${m}分`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h}時間` : `${h}時間${r}分`
}
