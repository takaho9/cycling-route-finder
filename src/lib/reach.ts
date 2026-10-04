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

/** 候補にする距離帯: 最大到達距離に対する比率 */
export const MIN_REACH_RATIO = 0.6
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

/**
 * 候補までの往復所要時間 (分) を推定。
 * - routed=false（既定）: oneWayKm は直線距離として迂回係数を掛ける
 * - routed=true: oneWayKm は実経路距離（OSRM 等）としてそのまま使う
 */
export function estimateRoundTripMin(
  oneWayKm: number,
  speedKmh: number,
  { routed = false, detourFactor = DETOUR_FACTOR }: { routed?: boolean; detourFactor?: number } = {},
): number {
  if (!(speedKmh > 0) || !(oneWayKm >= 0)) return 0
  const roadKm = routed ? oneWayKm : oneWayKm * detourFactor
  return ((roadKm * 2) / speedKmh) * 60
}

/** 「1時間15分」のような日本語表記 */
export function formatMinutesJa(min: number): string {
  const m = Math.round(min)
  if (m < 60) return `${m}分`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h}時間` : `${h}時間${r}分`
}
