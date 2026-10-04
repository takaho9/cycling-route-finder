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
  'attraction',
  'roadside_station',
  'other',
] as const

export type Category = (typeof CATEGORIES)[number]

export type PlaceSource = 'google' | 'overpass' | 'mock'

export type ElevationLabel = 'flat' | 'rolling' | 'hilly'

export interface ElevationSummary {
  /** 往路の獲得標高 (m) */
  gainOneWayM: number
  /** 往路の下り累積 (m) = 復路の獲得標高 */
  lossOneWayM: number
  /** 往復の獲得標高 (m) */
  gainRoundTripM: number
  /** 最大勾配 (%)。上り下りどちらも絶対値で評価（復路で上りになるため） */
  maxGradePct: number
  /** 往復の獲得標高 / 往復距離 (m/km) */
  gainPerKm: number
  label: ElevationLabel
  /** 出発地 → 目的地 の標高プロファイル (m)。等間隔サンプル */
  profile: number[]
  /** profile が表す片道距離 (km) */
  distanceKm: number
}

export interface Place {
  /** プロバイダ内で一意な ID (例: "osm:node/123", "google:ChIJ...", "mock:...") */
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
  source: PlaceSource
  elevation?: ElevationSummary
}

export interface PlaceProvider {
  name: PlaceSource
  search(center: LatLng, minKm: number, maxKm: number, signal?: AbortSignal): Promise<Place[]>
}
