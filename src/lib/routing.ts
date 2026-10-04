import { fetchJson, isAbortError, type RequestOptions } from './http'
import { haversineKm, interpolateLine } from './geo'
import type { LatLng } from './types'

/**
 * OSRM ベース URL。プロファイル部分まで含める。
 * NOTE: router.project-osrm.org のデモサーバは実質 car プロファイルのみ提供している可能性が高い。
 * 自転車ルートが必要なら https://routing.openstreetmap.de/routed-bike/route/v1/bike 等を検討。
 */
export const OSRM_BASE_URL = 'https://router.project-osrm.org/route/v1/bike'

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

export function buildOsrmUrl(origin: LatLng, dest: LatLng, baseUrl = OSRM_BASE_URL): string {
  const c = (p: LatLng) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`
  return `${baseUrl}/${c(origin)};${c(dest)}?overview=simplified&geometries=geojson`
}

export function straightRoute(origin: LatLng, dest: LatLng): RouteResult {
  return { path: interpolateLine(origin, dest, 2), distanceKm: haversineKm(origin, dest), source: 'straight' }
}

const routeCache = new Map<string, RouteResult>()
export function clearRouteCache(): void {
  routeCache.clear()
}

/**
 * 経路を 1 件取得（詳細表示時のみ呼ぶ想定。候補一覧で全件呼ばないこと）。
 * 失敗時は直線にフォールバック。呼び出し元の signal が abort された場合のみ AbortError を throw。
 */
export async function fetchRoute(
  origin: LatLng,
  dest: LatLng,
  { signal, timeoutMs = 8_000, baseUrl = OSRM_BASE_URL }: RequestOptions & { baseUrl?: string } = {},
): Promise<RouteResult> {
  const url = buildOsrmUrl(origin, dest, baseUrl)
  const cached = routeCache.get(url)
  if (cached) return cached
  try {
    const json = await fetchJson<OsrmResponse>(url, undefined, { signal, timeoutMs })
    const route = json.routes?.[0]
    const coords = route?.geometry?.coordinates
    if (json.code !== 'Ok' || !route || !Array.isArray(coords) || coords.length < 2) {
      throw new Error(`OSRM returned ${json.code ?? 'no route'}`)
    }
    const result: RouteResult = {
      path: coords.map(([lng, lat]) => ({ lat, lng })),
      distanceKm: route.distance / 1000,
      source: 'osrm',
    }
    routeCache.set(url, result)
    return result
  } catch (e) {
    if (isAbortError(e) && signal?.aborted) throw e
    console.warn('[routing] OSRM failed, falling back to straight line', e)
    return straightRoute(origin, dest)
  }
}
