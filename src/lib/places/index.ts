import { bearingDeg, haversineKm } from '../geo'
import { abortError, HttpError, TimeoutError } from '../http'
import { DEFAULT_SPEED_PRESET, searchBand, SPEED_PRESETS } from '../reach'
import type { LatLng, Place, PlaceProvider, PlaceSource } from '../types'
import { cacheKey, createDefaultPlacesCache, GRID_MARGIN_KM, snapToGrid, type PlacesCache } from './cache'
import { createMockProvider } from './mock'
import { createOverpassProvider, OverpassRemarkError } from './overpass'
import { createStaticProvider, OutOfCoverageError, type StaticProvider } from './static'

export { createMockProvider, generateMockPlaces, mockTerrainElevation } from './mock'
export { createOverpassProvider } from './overpass'
export { createStaticProvider, OutOfCoverageError } from './static'
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
  /** true なら事前生成データのサンプル版（網羅性が無いので UI はデモ扱いで表示, v1.3） */
  sample?: boolean
  /** true ならキャッシュから */
  fromCache?: boolean
  /** フォールバックに至った各プロバイダの失敗 */
  errors: { provider: PlaceSource; error: unknown }[]
}

/**
 * 都内の事前生成データ（static）→ Overpass →（全滅時のみ）Mock（v1.3）。
 * static は出発地が対象範囲外・取得失敗のとき throw して Overpass に譲る。
 * ランニングコスト 0 のためキー必須の API は使わない。
 */
export function createDefaultProviders(): PlaceProvider[] {
  return [createStaticProvider(), createOverpassProvider(), createMockProvider()]
}

/** 永続キャッシュ（IndexedDB, TTL 7 日）に入れるプロバイダ。static は SW が持つので不要、mock は入れない */
const PERSISTED_PROVIDERS: ReadonlySet<PlaceSource> = new Set<PlaceSource>(['overpass'])
const isStaticProvider = (p: PlaceProvider): p is StaticProvider => typeof (p as Partial<StaticProvider>).isSample === 'function'

/** デモモード（?demo=1）用: Mock のみ */
export function createDemoProviders(): PlaceProvider[] {
  return [createMockProvider()]
}

const memoryCache = new Map<string, SearchResult>()

/**
 * 同じキーの同時検索の共有（BACKLOG-2 C2）。
 * 共有 run は専用の AbortController を持ち、購読者（待っている呼び出し）が全員抜けたときだけ abort する。
 * 1 人目が abort しても、後から合流した呼び出しは結果を受け取れる。
 */
interface SharedRun {
  promise: Promise<SearchResult>
  controller: AbortController
  subscribers: number
}
const inflight = new Map<string, SharedRun>()
export function clearPlacesCache(): void {
  memoryCache.clear()
  inflight.clear()
}

export interface SearchPlacesOptions {
  signal?: AbortSignal
  /** 現在の速度プリセット (km/h)。検索半径 = この速度 × 90 分（C1）。キャッシュキーにも含める */
  speedKmh?: number
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
 * 出発地まわりの候補を「1 回だけ」取得する（R6: 時間チップの切替はクライアント側フィルタのみ）。
 * - 中心を約 1km グリッドにスナップし、現在の速度 × 90 分の半径で 1 リクエスト（C1。速度を変えたら再取得）。
 * - 同じキーの同時呼び出しは in-flight を共有（購読者カウント付き, C2）。結果は TTL 7 日でキャッシュ。
 * - プロバイダを順に試し、最初に「成功」したものを採用（0 件でも成功 = kind 'empty'）。
 *   失敗（ネットワーク/HTTP/タイムアウト/remark エラー）のときだけ次へ。mock 採用時は kind 'demo'（キャッシュしない）。
 * - 全プロバイダ失敗なら AggregateError。呼び出し元の abort は AbortError。
 */
export async function searchPlaces(
  center: LatLng,
  { signal, speedKmh = SPEED_PRESETS[DEFAULT_SPEED_PRESET].kmh, providers, useCache = true, cache, now = Date.now() }: SearchPlacesOptions = {},
): Promise<SearchResult> {
  if (signal?.aborted) throw abortError()
  const list = providers ?? createDefaultProviders()
  const band = searchBand(speedKmh)
  const maxKm = band.maxKm + GRID_MARGIN_KM
  const minKm = Math.max(0, band.minKm - GRID_MARGIN_KM)
  const snapped = snapToGrid(center)
  // in-flight 共有のキーはプロバイダ列全体。キャッシュのキーはプロバイダごと（static と overpass の結果を混ぜない, v1.3）
  const key = `${cacheKey(snapped, maxKm, list.map((p) => p.name).join('>'))}|${speedKmh}kmh`
  const providerKey = (name: PlaceSource) => `${cacheKey(snapped, maxKm, name)}|${speedKmh}kmh`
  const store = useCache ? (cache ?? (defaultCache ??= createDefaultPlacesCache())) : null

  const run = async (signal: AbortSignal): Promise<SearchResult> => {
    const errors: SearchResult['errors'] = []
    for (const provider of list) {
      const isDemo = provider.name === 'mock'
      const pkey = providerKey(provider.name)
      const persisted = !!store && PERSISTED_PROVIDERS.has(provider.name)
      if (useCache && !isDemo) {
        const hit = memoryCache.get(pkey) ?? (persisted ? await store!.get(pkey, now) : null)
        if (hit) {
          memoryCache.set(pkey, hit)
          return { ...hit, fromCache: true, errors: [...errors] }
        }
      }
      try {
        const raw = await provider.search(snapped, minKm, maxKm, signal)
        const places = raw.map((p) => ({ ...p, source: provider.name }))
        const sample = isStaticProvider(provider) && provider.isSample()
        const result: SearchResult = {
          kind: isDemo ? 'demo' : places.length ? 'ok' : 'empty',
          places,
          source: provider.name,
          isDemo,
          ...(sample ? { sample } : {}),
          errors: [...errors],
        }
        // デモ結果はキャッシュしない（回線復帰後に実データを取りに行けるように）。static はメモリだけ（SW が持つ）
        if (useCache && !isDemo) memoryCache.set(pkey, { ...result, errors: [] })
        if (persisted) await store!.put(pkey, result, now)
        return result
      } catch (e) {
        if (signal?.aborted) throw e
        errors.push({ provider: provider.name, error: e })
      }
    }
    throw new AggregateError(errors.map((e) => e.error), 'All place providers failed')
  }

  // in-flight 共有（C2）: 共有 run は呼び出し元の signal ではなく専用の controller で動かす
  let shared = inflight.get(key)
  if (!shared) {
    const controller = new AbortController()
    const run$ = run(controller.signal)
    const entry: SharedRun = {
      controller,
      subscribers: 0,
      promise: run$.finally(() => {
        if (inflight.get(key) === entry) inflight.delete(key)
      }),
    }
    entry.promise.catch(() => {}) // 購読者が全員抜けた後の reject を未処理にしない
    shared = entry
    inflight.set(key, entry)
  }
  const result = await subscribe(key, shared, signal)
  return { ...result, places: relocate(result.places, center) }
}

/** 共有 run を購読する。自分の signal が abort されたら自分だけ抜け、最後の 1 人なら run を abort する */
function subscribe(key: string, shared: SharedRun, signal?: AbortSignal): Promise<SearchResult> {
  if (signal?.aborted) return Promise.reject(abortError())
  shared.subscribers++
  return new Promise<SearchResult>((resolve, reject) => {
    let done = false
    const leave = () => {
      if (done) return
      done = true
      signal?.removeEventListener('abort', onAbort)
      shared.subscribers--
    }
    const onAbort = () => {
      leave()
      if (shared.subscribers <= 0) {
        if (inflight.get(key) === shared) inflight.delete(key)
        shared.controller.abort()
      }
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    shared.promise.then(
      (v) => {
        if (done) return
        leave()
        resolve(v)
      },
      (e) => {
        if (done) return
        leave()
        reject(e)
      },
    )
  })
}

/** テスト用: 進行中の共有検索の数 */
export function inflightCount(): number {
  return inflight.size
}

export type FallbackReason = 'busy' | 'network' | 'unknown'

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false

/**
 * 実データが取れなかった理由（UI のやさしい文言用）。
 * オンラインなのに TypeError（CORS ヘッダの無い 429/504 など）は「混雑」扱い（BACKLOG-2 C12）。
 */
export function fallbackReason(errors: readonly { error: unknown }[], online: boolean = isOnline()): FallbackReason | null {
  // static の「対象範囲外」は失敗ではない
  const flat = errors
    .flatMap(({ error }) => (error instanceof AggregateError ? error.errors : [error]))
    .filter((e) => !(e instanceof OutOfCoverageError))
  if (flat.length === 0) return null
  if (
    flat.some(
      (e) => (e instanceof HttpError && (e.status === 429 || e.status >= 500)) || e instanceof TimeoutError || e instanceof OverpassRemarkError,
    )
  ) {
    return 'busy'
  }
  if (flat.some((e) => e instanceof TypeError)) return online ? 'busy' : 'network'
  return 'unknown'
}

export const FALLBACK_MESSAGES: Record<FallbackReason, string> = {
  busy: '地図データのサーバーが混み合ってるみたい。少し時間をおくと実データになるよ',
  network: '電波がちょっと迷子みたい。つながったら実データになるよ',
  unknown: 'いまは実データを取れなかったみたい。あとでもう一度さがしてみてね',
}
