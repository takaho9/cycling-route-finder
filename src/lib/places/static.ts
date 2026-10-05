import { haversineKm } from '../geo'
import { fetchJson, mapWithConcurrency } from '../http'
import type { LatLng, Place, PlaceProvider } from '../types'
import { inCoverage, recordToPlace, tileFileName, tilesForCircle, type StaticIndex, type StaticRecord, type StaticTile } from './staticData'

/**
 * 出発地が対象範囲（都内）の外。失敗ではなく「対象外」なので、次のプロバイダ（Overpass）へ進む合図。
 * fallbackReason（デモ表示の理由）には数えない。
 */
export class OutOfCoverageError extends Error {
  constructor() {
    super('Origin is outside the static data coverage')
    this.name = 'OutOfCoverageError'
  }
}

/** 静的データの置き場所（BASE_URL 基準。GitHub Pages のサブパスでも動く） */
export function staticDataBaseUrl(): string {
  const base = import.meta.env?.BASE_URL ?? '/'
  return `${base.endsWith('/') ? base : `${base}/`}data/tokyo/`
}

export const STATIC_INDEX_TIMEOUT_MS = 6_000
export const STATIC_TILE_TIMEOUT_MS = 8_000
/** タイルの同時取得数（半径 12km でも 20〜30 タイル程度） */
export const STATIC_TILE_CONCURRENCY = 6

function isStaticIndex(v: unknown): v is StaticIndex {
  const x = v as StaticIndex
  return (
    !!x &&
    typeof x === 'object' &&
    typeof x.version === 'string' &&
    !!x.tiles &&
    typeof x.tiles === 'object' &&
    Array.isArray(x.coverage?.bbox) &&
    x.coverage.bbox.length === 4
  )
}

/** index.json の読み込み（成功したらメモリに保持。失敗したら次回また取りに行く） */
const indexes = new Map<string, StaticIndex>()
export async function loadStaticIndex(baseUrl = staticDataBaseUrl(), signal?: AbortSignal): Promise<StaticIndex> {
  const hit = indexes.get(baseUrl)
  if (hit) return hit
  const json = await fetchJson<unknown>(`${baseUrl}index.json`, undefined, { signal, timeoutMs: STATIC_INDEX_TIMEOUT_MS })
  if (!isStaticIndex(json)) throw new Error('Invalid static index.json')
  indexes.set(baseUrl, json)
  return json
}

/** 読み込み済みの index（設定画面のクレジット表示用。未読込なら null） */
export function peekStaticIndex(baseUrl = staticDataBaseUrl()): StaticIndex | null {
  return indexes.get(baseUrl) ?? null
}

const tiles = new Map<string, StaticRecord[]>()

/** テスト用: メモリ上の index / タイルを消す */
export function clearStaticCache(): void {
  indexes.clear()
  tiles.clear()
}

export interface StaticProviderOptions {
  baseUrl?: string
  concurrency?: number
}

export interface StaticProvider extends PlaceProvider {
  /** 直近に使った index がサンプルデータか */
  isSample(): boolean
}

/**
 * 事前生成した都内データのプロバイダ（v1.3）。
 * - index.json を読み、出発地が対象範囲外なら OutOfCoverageError（→ Overpass へ）
 * - 範囲内なら検索円にかかるタイルのうち、件数のあるものだけを取得（0 件タイルはファイル自体が無い）
 * - index / タイルの取得失敗は普通に throw（→ Overpass へ）
 * - 都境をまたぐ半径でも都内の分だけ返す（PdM 判断）
 * オフライン時は Service Worker（runtimeCaching）が一度読んだタイルを返す。
 */
export function createStaticProvider({ baseUrl = staticDataBaseUrl(), concurrency = STATIC_TILE_CONCURRENCY }: StaticProviderOptions = {}): StaticProvider {
  let sample = false
  const loadTile = async (key: string, version: string, signal?: AbortSignal): Promise<StaticRecord[]> => {
    const ck = `${baseUrl}|${version}|${key}`
    const hit = tiles.get(ck)
    if (hit) return hit
    const json = await fetchJson<StaticTile>(`${baseUrl}${tileFileName(key)}?v=${encodeURIComponent(version)}`, undefined, {
      signal,
      timeoutMs: STATIC_TILE_TIMEOUT_MS,
    })
    if (!json || !Array.isArray(json.p)) throw new Error(`Invalid static tile ${key}`)
    tiles.set(ck, json.p)
    return json.p
  }
  return {
    name: 'static',
    isSample: () => sample,
    async search(center: LatLng, _minKm: number, maxKm: number, signal?: AbortSignal): Promise<Place[]> {
      const index = await loadStaticIndex(baseUrl, signal)
      sample = !!index.sample
      if (!inCoverage(index, center)) throw new OutOfCoverageError()
      const keys = tilesForCircle(center, maxKm).filter((k) => (index.tiles[k] ?? 0) > 0)
      const lists = await mapWithConcurrency(keys, concurrency, (k) => loadTile(k, index.version, signal))
      const out: Place[] = []
      for (const r of lists.flat()) {
        if (haversineKm(center, { lat: r.y, lng: r.x }) > maxKm) continue
        out.push(recordToPlace(r, center))
      }
      return out
    },
  }
}
