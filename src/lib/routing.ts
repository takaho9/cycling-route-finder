import { fetchJson, isAbortError, type RequestOptions } from './http'
import { haversineKm, interpolateLine } from './geo'
import type { LatLng } from './types'

/**
 * OSRM 互換サーバのベース URL（プロファイル部分まで含む）。先頭から順に試し、全滅なら直線。
 * FOSSGIS の routed-bike は自転車プロファイル。サーバ実装によってはパスのプロファイル名を
 * 無視/拒否するため、`driving` 名で投げる版もフォールバックとして試す（BACKLOG R3）。
 */
export const OSRM_BASE_URLS = [
  'https://routing.openstreetmap.de/routed-bike/route/v1/bike',
  'https://routing.openstreetmap.de/routed-bike/route/v1/driving',
] as const
export const OSRM_BASE_URL = OSRM_BASE_URLS[0]
/** 外部に送る座標の桁数（約 11m） */
const COORD_DECIMALS = 4

export interface RouteResult {
  /** 経路形状（出発地→目的地） */
  path: LatLng[]
  /** 片道の経路距離 (km)。フォールバック時は直線距離 */
  distanceKm: number
  source: 'osrm' | 'straight'
}

interface OsrmResponse {
  code?: string
  routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[]
}

export function buildOsrmUrl(origin: LatLng, dest: LatLng, baseUrl: string = OSRM_BASE_URL): string {
  const c = (p: LatLng) => `${p.lng.toFixed(COORD_DECIMALS)},${p.lat.toFixed(COORD_DECIMALS)}`
  return `${baseUrl}/${c(origin)};${c(dest)}?overview=simplified&geometries=geojson`
}

export function straightRoute(origin: LatLng, dest: LatLng): RouteResult {
  return { path: interpolateLine(origin, dest, 2), distanceKm: haversineKm(origin, dest), source: 'straight' }
}

const routeCache = new Map<string, RouteResult>()
export function clearRouteCache(): void {
  routeCache.clear()
}

async function fetchOsrm(url: string, opts: RequestOptions): Promise<RouteResult> {
  const json = await fetchJson<OsrmResponse>(url, undefined, opts)
  const route = json.routes?.[0]
  const coords = route?.geometry?.coordinates
  if (json.code !== 'Ok' || !route || !Array.isArray(coords) || coords.length < 2) {
    throw new Error(`OSRM returned ${json.code ?? 'no route'}`)
  }
  return { path: coords.map(([lng, lat]) => ({ lat, lng })), distanceKm: route.distance / 1000, source: 'osrm' }
}

/**
 * 経路を 1 件取得（詳細表示時のみ呼ぶ想定。候補一覧で全件呼ばないこと）。
 * baseUrls を順に試し、全滅なら直線にフォールバック。呼び出し元の signal が abort された場合のみ AbortError を throw。
 */
export async function fetchRoute(
  origin: LatLng,
  dest: LatLng,
  {
    signal,
    timeoutMs = 8_000,
    baseUrls = OSRM_BASE_URLS,
  }: RequestOptions & { baseUrls?: readonly string[] } = {},
): Promise<RouteResult> {
  const cacheKey = buildOsrmUrl(origin, dest, '')
  const cached = routeCache.get(cacheKey)
  if (cached) return cached
  for (const base of baseUrls) {
    try {
      const result = await fetchOsrm(buildOsrmUrl(origin, dest, base), { signal, timeoutMs })
      routeCache.set(cacheKey, result)
      return result
    } catch (e) {
      if (isAbortError(e) && signal?.aborted) throw e
      console.warn(`[routing] ${base} failed`, e)
    }
  }
  return straightRoute(origin, dest)
}
