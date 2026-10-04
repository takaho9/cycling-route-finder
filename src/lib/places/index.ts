import { bearingDeg, haversineKm } from '../geo'
import { HttpError, TimeoutError } from '../http'
import { searchBand } from '../reach'
import type { LatLng, Place, PlaceProvider, PlaceSource } from '../types'
import { cacheKey, createDefaultPlacesCache, GRID_MARGIN_KM, snapToGrid, type PlacesCache } from './cache'
import { createMockProvider } from './mock'
import { createOverpassProvider, OverpassRemarkError } from './overpass'

export { createMockProvider, generateMockPlaces, mockTerrainElevation } from './mock'
export { createOverpassProvider } from './overpass'
export { balancedSample, dedupeNearby, filterDonut, MAX_CANDIDATES } from './sampling'

/** 取得結果の種類（BACKLOG R2）。UI はこれで出し分ける */
export type SearchKind = 'ok' | 'empty' | 'demo'

export interface SearchResult {
  kind: SearchKind
  /** 検索範囲内の全候補（時間帯での絞り込みはクライアント側, R6） */
  places: Place[]
  source: PlaceSource
  /** true ならデモデータ（UI で必ず表示する） */
  isDemo: boolean
  /** true ならキャッシュから */
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
const inflight = new Map<string, Promise<SearchResult>>()
export function clearPlacesCache(): void {
  memoryCache.clear()
  inflight.clear()
}

export interface SearchPlacesOptions {
  signal?: AbortSignal
  providers?: PlaceProvider[]
  /** メモリ + 永続キャッシュ(TTL 7日)を使う */
  useCache?: boolean
  cache?: PlacesCache
  now?: number
}

/** スナップ済み中心で取得した結果を、実際の中心からの距離・方位に付け替える */
function relocate(places: Place[], center: LatLng): Place[] {
  return places.map((p) => ({ ...p, distanceKm: haversineKm(center, p), bearing: bearingDeg(center, p) }))
}

let defaultCache: PlacesCache | null = null

/**
 * 出発地まわりの候補を「1 回だけ」取得する（R6: 時間チップ・速度の切替はクライアント側フィルタのみ）。
 * - 中心を約 1km グリッドにスナップし、全プリセット×全時間をカバーする半径で 1 リクエスト。
 * - 同じキーの同時呼び出しは in-flight Promise を共有。結果は TTL 7 日でキャッシュ。
 * - プロバイダを順に試し、最初に「成功」したものを採用（0 件でも成功 = kind 'empty'）。
 *   失敗（ネットワーク/HTTP/タイムアウト/remark エラー）のときだけ次へ。mock 採用時は kind 'demo'（キャッシュしない）。
 * - 全プロバイダ失敗なら AggregateError。呼び出し元の abort は AbortError。
 */
export async function searchPlaces(
  center: LatLng,
  { signal, providers, useCache = true, cache, now = Date.now() }: SearchPlacesOptions = {},
): Promise<SearchResult> {
  const list = providers ?? createDefaultProviders()
  const band = searchBand()
  const maxKm = band.maxKm + GRID_MARGIN_KM
  const minKm = Math.max(0, band.minKm - GRID_MARGIN_KM)
  const snapped = snapToGrid(center)
  const key = cacheKey(snapped, maxKm, list.map((p) => p.name).join('>'))
  const store = useCache ? (cache ?? (defaultCache ??= createDefaultPlacesCache())) : null

  const run = async (): Promise<SearchResult> => {
    if (store) {
      const hit = memoryCache.get(key) ?? (await store.get(key, now))
      if (hit) {
        memoryCache.set(key, hit)
        return { ...hit, fromCache: true }
      }
    }
    const errors: SearchResult['errors'] = []
    for (const provider of list) {
      try {
        const raw = await provider.search(snapped, minKm, maxKm, signal)
        const places = raw.map((p) => ({ ...p, source: provider.name }))
        const isDemo = provider.name === 'mock'
        const result: SearchResult = {
          kind: isDemo ? 'demo' : places.length ? 'ok' : 'empty',
          places,
          source: provider.name,
          isDemo,
          errors: [...errors],
        }
        // デモ結果はキャッシュしない（回線復帰後に実データを取りに行けるように）
        if (store && !isDemo) {
          memoryCache.set(key, result)
          await store.put(key, result, now)
        }
        return result
      } catch (e) {
        if (signal?.aborted) throw e
        errors.push({ provider: provider.name, error: e })
      }
    }
    throw new AggregateError(errors.map((e) => e.error), 'All place providers failed')
  }

  // in-flight 共有（abort は呼び出し側ごとに扱えないため、signal 付きの呼び出しは共有しても結果待ちのみ中断）
  let p = inflight.get(key)
  if (!p) {
    p = run().finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  const result = await (signal ? raceAbort(p, signal) : p)
  return { ...result, places: relocate(result.places, center) }
}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      },
    )
  })
}

export type FallbackReason = 'busy' | 'network' | 'unknown'

/** 実データが取れなかった理由（UI のやさしい文言用） */
export function fallbackReason(errors: readonly { error: unknown }[]): FallbackReason | null {
  if (errors.length === 0) return null
  const flat = errors.flatMap(({ error }) => (error instanceof AggregateError ? error.errors : [error]))
  if (
    flat.some(
      (e) => (e instanceof HttpError && (e.status === 429 || e.status >= 500)) || e instanceof TimeoutError || e instanceof OverpassRemarkError,
    )
  ) {
    return 'busy'
  }
  if (flat.some((e) => e instanceof TypeError)) return 'network'
  return 'unknown'
}

export const FALLBACK_MESSAGES: Record<FallbackReason, string> = {
  busy: '地図データのサーバーが混み合ってるみたい。少し時間をおくと実データになるよ',
  network: '電波がちょっと迷子みたい。つながったら実データになるよ',
  unknown: 'いまは実データを取れなかったみたい。あとでもう一度さがしてみてね',
}
