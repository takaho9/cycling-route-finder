export interface LatLng {
  lat: number
  lng: number
}

export const CATEGORIES = [
  'park',
  'viewpoint',
  'cafe',
  'bakery',
  'shrine',
  'historic',
  'waterside',
  'seaside',
  'museum',
  'sweets',
  'attraction',
  'roadside_station',
  'other',
] as const

export type Category = (typeof CATEGORIES)[number]

/** static = 事前生成した都内データ（public/data/tokyo, v1.3） */
export type PlaceSource = 'static' | 'overpass' | 'mock'

/** 事前生成データに埋め込んだ写真（Commons で解決済み, v1.3）。実行時の写真さがしを省く */
export interface EmbeddedPhoto {
  /** 幅 500px のサムネ（一覧） */
  url500: string
  /** 幅 960px のサムネ（詳細） */
  url960: string
  artist?: string
  license?: string
  /** Commons のファイルページ */
  pageUrl?: string
  /** true = 施設そのものではなく付近の写真 */
  nearby?: boolean
}

export type ElevationLabel = 'flat' | 'rolling' | 'hilly'

export interface ElevationSummary {
  /** 往路の獲得標高 (m) */
  gainOneWayM: number
  /** 往路の下り累積 (m) = 復路の獲得標高 */
  lossOneWayM: number
  /** 往復の獲得標高 (m) */
  gainRoundTripM: number
  /** 最大勾配 (%)。一定距離以上の区間で平滑化し、上り下りどちらも絶対値で評価（復路で上りになるため） */
  maxGradePct: number
  /** G: きつい方向の獲得標高 = max(往路の獲得, 復路の獲得) (m)。ラベル判定に使う */
  climbM: number
  /** R: G ÷ 片道距離 (m/km) */
  climbPerKm: number
  label: ElevationLabel
  /** 出発地 → 目的地 の標高プロファイル (m)。欠損点は除外済み */
  profile: number[]
  /** profile 各点の出発地からの距離 (km) */
  profileKm: number[]
  /** profile が表す片道距離 (km) */
  distanceKm: number
  /**
   * true = 一覧用の直線補間による推定（最大勾配はラベル判定に使わない）。
   * false = 詳細で経路形状に沿って確定した値。
   */
  estimated: boolean
  /** 標高 <= 0m のサンプルが連続した最大数（海上・水面を横切る直線の目安） */
  seaRun: number
}

export interface Place {
  /** プロバイダ内で一意な ID (例: "osm:node/123", "mock:...") */
  id: string
  name: string
  lat: number
  lng: number
  category: Category
  /** 出発地からの直線距離 (km) */
  distanceKm: number
  /** 出発地からの方位 (度, 0=北, 時計回り) */
  bearing: number
  /** OSM タグ等の生データ (wikidata / wikimedia_commons / image などを保持) */
  tags?: Record<string, string>
  photoUrl?: string
  /** 事前生成データの埋め込み写真（static のみ） */
  photoEmbed?: EmbeddedPhoto
  /** 事前計算した見栄えスコア（static のみ。あれば attractiveness() はこれを使う） */
  score?: number
  source: PlaceSource
  elevation?: ElevationSummary
}

export interface PlaceProvider {
  name: PlaceSource
  search(center: LatLng, minKm: number, maxKm: number, signal?: AbortSignal): Promise<Place[]>
}
