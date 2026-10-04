import { bearingDeg, haversineKm } from '../geo'
import { HttpError, isAbortError, TimeoutError } from '../http'
import type { LatLng, Place, PlaceProvider, PlaceSource } from '../types'
import { cacheKey, readCache, snapToGrid, writeCache } from './cache'
import { createMockProvider } from './mock'
import { createOverpassProvider } from './overpass'

export { createMockProvider, generateMockPlaces, mockTerrainElevation } from './mock'
export { createOverpassProvider } from './overpass'
export { balancedSample, dedupeByName, filterDonut, MAX_CANDIDATES } from './sampling'

export interface SearchResult {
  places: Place[]
  source: PlaceSource
  /** true ならデモデータ（UI で必ず表示する） */
  isDemo: boolean
  /** true ならキャッシュ（localStorage）から */
  fromCache?: boolean
  /** フォールバックに至った各プロバイダの失敗 */
  errors: { provider: PlaceSource; error: unknown }[]
}

/** Overpass →（全滅時のみ）Mock。ランニングコスト 0 のためキー必須の API は使わない */
export function createDefaultProviders(): PlaceProvider[] {
  return [createOverpassProvider(), createMockProvider()]
}

/** デモモード（?demo=1）用: Mock のみ */
export function createDemoProviders(): PlaceProvider[] {
  return [createMockProvider()]
}

const memoryCache = new Map<string, SearchResult>()
export function clearPlacesCache(): void {
  memoryCache.clear()
}

export interface SearchPlacesOptions {
  signal?: AbortSignal
  providers?: PlaceProvider[]
  /** メモリ + localStorage(TTL 24h) キャッシュを使う */
  useCache?: boolean
  now?: number
}

/** キャッシュ（スナップ済み中心で取得）の結果を実際の中心からの距離・方位に付け替える */
function relocate(places: Place[], center: LatLng): Place[] {
  return places.map((p) => ({ ...p, distanceKm: haversineKm(center, p), bearing: bearingDeg(center, p) }))
}

/**
 * プロバイダを順に試し、最初に「成功」したものの結果を採用する（0 件でも成功。空状態は UI で扱う）。
 * 失敗（ネットワークエラー・HTTP エラー・タイムアウト等）のときだけ次のプロバイダへ。
 * - 公開 API に優しくするため、中心を約 500m グリッドにスナップしてクエリし、結果を 24 時間キャッシュ。
 * - mock が使われたら isDemo=true（キャッシュしない）。全プロバイダ失敗なら AggregateError。
 * - 呼び出し元の signal が abort された場合は AbortError を throw。
 */
export async function searchPlaces(
  center: LatLng,
  minKm: number,
  maxKm: number,
  { signal, providers, useCache = true, now = Date.now() }: SearchPlacesOptions = {},
): Promise<SearchResult> {
  const list = providers ?? createDefaultProviders()
  const snapped = snapToGrid(center)
  const key = cacheKey(snapped, minKm, maxKm, list.map((p) => p.name).join('>'))
  if (useCache) {
    const hit = memoryCache.get(key) ?? readCache(key, now)
    if (hit) {
      memoryCache.set(key, hit)
      return { ...hit, places: relocate(hit.places, center), fromCache: true }
    }
  }
  const errors: SearchResult['errors'] = []
  for (const provider of list) {
    try {
      const raw = await provider.search(snapped, minKm, maxKm, signal)
      const places = raw.map((p) => ({ ...p, source: provider.name }))
      const result: SearchResult = { places, source: provider.name, isDemo: provider.name === 'mock', errors: [...errors] }
      // デモ結果はキャッシュしない（回線復帰後に実データを取りに行けるように）
      if (useCache && !result.isDemo) {
        memoryCache.set(key, result)
        writeCache(key, result, now)
      }
      return { ...result, places: relocate(places, center) }
    } catch (e) {
      if (signal?.aborted) throw e
      errors.push({ provider: provider.name, error: e })
    }
  }
  throw new AggregateError(errors.map((e) => e.error), 'All place providers failed')
}

export type FallbackReason = 'busy' | 'network' | 'unknown'

/** 実データが取れなかった理由（UI のやさしい文言用） */
export function fallbackReason(errors: readonly { error: unknown }[]): FallbackReason | null {
  if (errors.length === 0) return null
  const flat = errors.flatMap(({ error }) => (error instanceof AggregateError ? error.errors : [error]))
  if (flat.some((e) => (e instanceof HttpError && (e.status === 429 || e.status >= 500)) || e instanceof TimeoutError)) {
    return 'busy'
  }
  if (flat.some((e) => e instanceof TypeError && !isAbortError(e))) return 'network'
  return 'unknown'
}

export const FALLBACK_MESSAGES: Record<FallbackReason, string> = {
  busy: '地図データのサーバーが混み合ってるみたい。少し時間をおくと実データになるよ',
  network: '電波がちょっと迷子みたい。つながったら実データになるよ',
  unknown: 'いまは実データを取れなかったみたい。あとでもう一度さがしてみてね',
}
