import { fetchJson, isAbortError, type RequestOptions } from './http'
import { haversineKm, interpolateLine } from './geo'
import { createKvCache, type KvCache } from './kvCache'
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
/** メモリ層を消す（永続層は残す） */
export function clearRouteCache(): void {
  routeCache.clear()
}

/** 永続キャッシュ（v1.2）: 道路は変わりうるので 7 日。直線フォールバックは保存しない */
export const ROUTE_PERSIST_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const ROUTE_PERSIST_MAX = 100
let persistent: KvCache<RouteResult> | null | undefined

function routeStore(): KvCache<RouteResult> | null {
  return (persistent ??= createKvCache<RouteResult>({
    namespace: 'route',
    ttlMs: ROUTE_PERSIST_TTL_MS,
    maxEntries: ROUTE_PERSIST_MAX,
    maxEntriesLocalStorage: 20,
  }))
}

/** テスト用: 永続層を差し替える（null = 永続層なし, undefined = 既定に戻す） */
export function setRoutePersistentCache(c: KvCache<RouteResult> | null | undefined): void {
  persistent = c
}

const isRouteResult = (r: unknown): r is RouteResult =>
  !!r &&
  typeof r === 'object' &&
  (r as RouteResult).source === 'osrm' &&
  typeof (r as RouteResult).distanceKm === 'number' &&
  Array.isArray((r as RouteResult).path) &&
  (r as RouteResult).path.length >= 2

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
  const store = routeStore()
  const stored = store ? await store.get(cacheKey) : undefined
  if (signal?.aborted) {
    const e = new Error('The operation was aborted')
    e.name = 'AbortError'
    throw e
  }
  if (isRouteResult(stored)) {
    routeCache.set(cacheKey, stored)
    return stored
  }
  for (const base of baseUrls) {
    try {
      const result = await fetchOsrm(buildOsrmUrl(origin, dest, base), { signal, timeoutMs })
      routeCache.set(cacheKey, result)
      if (store) void store.set(cacheKey, result)
      return result
    } catch (e) {
      if (isAbortError(e) && signal?.aborted) throw e
      console.warn(`[routing] ${base} failed`, e)
    }
  }
  return straightRoute(origin, dest)
}
