import type { PhotoInfo } from '../lib/photos'
import type { ElevationSummary, LatLng, Place } from '../lib/types'

/** UI 表示用に写真・標高の段階ロード状態を合成した Place */
export interface ViewPlace extends Place {
  /** undefined = 取得中 / null = なし（フォールバック表示） */
  photo?: PhotoInfo | null
  /** 'loading' = 取得中, 'none' = 取得失敗 */
  elevationState: 'loading' | 'ready' | 'none'
  elevation?: ElevationSummary
  /** 詳細で取れた経路（OSRM）の片道距離 (km)。あれば一覧の距離・時間もこれで計算（D2） */
  routeKm?: number
  visited: boolean
  favorite: boolean
}

export type OriginKind = 'gps' | 'manual' | 'demo'

export interface Origin extends LatLng {
  label: string
  kind: OriginKind
  /** GPS 精度 (m) */
  accuracyM?: number
}

export type { TripMode as RouteMode } from '../lib/trip'
