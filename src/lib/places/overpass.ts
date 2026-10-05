import { bearingDeg, haversineKm } from '../geo'
import { abortError, fetchJson, HttpError, isAbortError, sleep, TimeoutError } from '../http'
import type { Category, LatLng, Place, PlaceProvider } from '../types'

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const

/** Overpass サーバ側タイムアウト (秒) */
export const OVERPASS_SERVER_TIMEOUT_S = 12
/** 1 本目エンドポイントのタイムアウト (ms, BACKLOG R6) */
export const OVERPASS_FIRST_TIMEOUT_MS = 10_000
/** 検索全体の時間予算 (ms, BACKLOG A1) */
export const OVERPASS_BUDGET_MS = 14_000
/** 1 本目が返らないとき 2 本目を並列で投げ始めるまでの待ち (ms) */
export const OVERPASS_HEDGE_DELAY_MS = 6_000
/** 429/504 の Retry-After をこの秒数まで尊重して同一エンドポイントに 1 回だけ再試行 */
export const OVERPASS_MAX_RETRY_AFTER_S = 3
/** 公園の最小規模: バウンディングボックス対角 (m)。wikidata / heritage 付きなら小さくても可 */
export const MIN_PARK_BBOX_DIAGONAL_M = 400
/** 名前から小規模と判断する公園 */
export const SMALL_PARK_NAME_RE = /児童遊園|ちびっこ|児童公園|ポケットパーク|遊び場|プチテラス/
const WATERSIDE_NAME_RE = /河川敷|親水|水辺|湖畔|川沿い/
const SEASIDE_NAME_RE = /海浜|海岸|ビーチ|臨海|浜/

type SelectorKind = 'node' | 'area' | 'park'
interface Selector {
  /** node: node のみ / area: way+relation / park: way+relation で bounds が必要 */
  kinds: SelectorKind[]
  filter: string
}

const NO_BRAND = '[!"brand"][!"brand:wikidata"]'
/**
 * 取得するセレクタ（BACKLOG Y1/A3）。
 * - node は `out body`、way/relation は `out tags center`（公園は規模判定のため `out tags bb`）
 * - waterway=riverbank 等の巨大ポリゴンは避け、名前付き水面・ビーチ・マリーナに限定
 * - サーバ側の件数上限は付けない（クライアント側 balancedSample に任せる）
 */
export const OVERPASS_SELECTORS: readonly Selector[] = [
  { kinds: ['park'], filter: '["leisure"~"^(park|garden)$"]["name"]["access"!~"^(private|no)$"]' },
  { kinds: ['node'], filter: '["tourism"="viewpoint"]["name"]' },
  { kinds: ['node'], filter: `["amenity"="cafe"]["name"]${NO_BRAND}` },
  { kinds: ['node'], filter: `["shop"="bakery"]["name"]${NO_BRAND}` },
  { kinds: ['node', 'area'], filter: '["amenity"="place_of_worship"]["name"]["religion"~"^(shinto|buddhist)$"]' },
  { kinds: ['node', 'area'], filter: '["historic"]["name"]["historic"!~"^(memorial|boundary_stone|milestone|wayside_shrine|wayside_cross|tomb)$"]' },
  { kinds: ['node', 'area'], filter: '["natural"="beach"]["name"]' },
  { kinds: ['area'], filter: '["natural"="water"]["name"]["water"~"^(lake|pond|reservoir)$"]' },
  { kinds: ['node', 'area'], filter: '["leisure"="marina"]["name"]' },
  { kinds: ['node', 'area'], filter: '["tourism"="attraction"]["name"]' },
  { kinds: ['node', 'area'], filter: '["tourism"~"^(museum|gallery)$"]["name"]' },
  { kinds: ['node'], filter: `["shop"~"^(confectionery|pastry|chocolate)$"]["name"]${NO_BRAND}` },
  { kinds: ['node'], filter: `["amenity"="ice_cream"]["name"]${NO_BRAND}` },
  { kinds: ['node', 'area'], filter: '["highway"~"^(services|rest_area)$"]["name"~"道の駅"]' },
]

/**
 * 1 回の検索で 1 リクエストにまとめたクエリ（BACKLOG R6/A3）。
 * around(maxKm) で取得し、ドーナツ・時間帯の絞り込みはクライアント側で行う。
 */
export function buildOverpassQuery(center: LatLng, maxKm: number): string {
  const around = `(around:${Math.round(maxKm * 1000)},${center.lat.toFixed(4)},${center.lng.toFixed(4)})`
  const group = (kind: SelectorKind) =>
    OVERPASS_SELECTORS.filter((s) => s.kinds.includes(kind)).flatMap((s) =>
      kind === 'node' ? [`node${s.filter}${around};`] : [`way${s.filter}${around};`, `relation${s.filter}${around};`],
    )
  return [
    `[out:json][timeout:${OVERPASS_SERVER_TIMEOUT_S}];`,
    `(${group('node').join('')})->.n;`,
    `.n out body;`,
    `(${group('park').join('')})->.p;`,
    `.p out tags bb;`,
    `(${group('area').join('')})->.a;`,
    `.a out tags center;`,
  ].join('\n')
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number }
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

export interface OverpassResponse {
  elements?: OverpassElement[]
  remark?: string
}

/** HTTP 200 でも remark にランタイムエラーが入ることがある（BACKLOG A1） */
export class OverpassRemarkError extends Error {
  constructor(remark: string) {
    super(`Overpass remark: ${remark}`)
    this.name = 'OverpassRemarkError'
  }
}

export function checkOverpassRemark(json: OverpassResponse): void {
  const r = json.remark
  if (r && /runtime error|timed out|out of memory|error/i.test(r)) throw new OverpassRemarkError(r)
}

/** OSM タグからカテゴリ判定 */
export function categorizeOsmTags(tags: Record<string, string>): Category {
  const name = tags.name ?? ''
  if (/道の駅/.test(name) || tags.highway === 'services' || tags.highway === 'rest_area') return 'roadside_station'
  if (tags.tourism === 'viewpoint') return 'viewpoint'
  if (tags.amenity === 'cafe') return 'cafe'
  if (tags.shop === 'bakery') return 'bakery'
  if (tags.shop === 'confectionery' || tags.shop === 'pastry' || tags.shop === 'chocolate' || tags.amenity === 'ice_cream') {
    return 'sweets'
  }
  if (tags.amenity === 'place_of_worship') return 'shrine'
  if (tags.tourism === 'museum' || tags.tourism === 'gallery') return 'museum'
  if (tags.natural === 'beach' || tags.natural === 'coastline') return 'seaside'
  if (tags.natural === 'water' || tags.leisure === 'marina') return 'waterside'
  if (tags.leisure === 'park' || tags.leisure === 'garden') {
    if (SEASIDE_NAME_RE.test(name)) return 'seaside'
    return WATERSIDE_NAME_RE.test(name) ? 'waterside' : 'park'
  }
  if (tags.historic) return 'historic'
  if (tags.tourism === 'attraction') return 'attraction'
  return 'other'
}

function elementCenter(el: OverpassElement): LatLng | null {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') return { lat: el.lat, lng: el.lon }
  if (el.center) return { lat: el.center.lat, lng: el.center.lon }
  if (el.bounds) {
    return { lat: (el.bounds.minlat + el.bounds.maxlat) / 2, lng: (el.bounds.minlon + el.bounds.maxlon) / 2 }
  }
  return null
}

function bboxDiagonalM(el: OverpassElement): number {
  if (!el.bounds) return 0
  const b = el.bounds
  return haversineKm({ lat: b.minlat, lng: b.minlon }, { lat: b.maxlat, lng: b.maxlon }) * 1000
}

/** 小規模公園・チェーン店などノイズを除外（BACKLOG Y1） */
function isWorthVisiting(el: OverpassElement, category: Category): boolean {
  const tags = el.tags ?? {}
  if (tags.leisure === 'park' || tags.leisure === 'garden') {
    if (SMALL_PARK_NAME_RE.test(tags.name ?? '')) return false
    const notable = !!(tags.wikidata || tags.heritage)
    if (!notable && (el.type === 'node' || bboxDiagonalM(el) < MIN_PARK_BBOX_DIAGONAL_M)) return false
  }
  if ((category === 'cafe' || category === 'bakery' || category === 'sweets') && (tags.brand || tags['brand:wikidata'])) return false
  if (category === 'shrine' && tags.religion && !/^(shinto|buddhist)$/.test(tags.religion)) return false
  if (tags.access === 'private' || tags.access === 'no') return false
  if (tags.disused === 'yes' || tags['disused:amenity']) return false
  return true
}

/** タグのうち保持するもの */
const KEPT_TAG_KEYS = [
  'name',
  'name:en',
  'name:ja',
  'wikidata',
  'wikipedia',
  'wikimedia_commons',
  'image',
  'heritage',
  'website',
  'opening_hours',
  'religion',
  'historic',
  'tourism',
  'amenity',
  'leisure',
  'natural',
  'shop',
  'cuisine',
] as const

export function parseOverpassElements(elements: readonly OverpassElement[], center: LatLng): Place[] {
  const out: Place[] = []
  const seenIds = new Set<string>()
  for (const el of elements) {
    const tags = el.tags ?? {}
    const name = tags['name:ja'] ?? tags.name
    if (!name) continue
    const pos = elementCenter(el)
    if (!pos) continue
    const id = `osm:${el.type}/${el.id}`
    if (seenIds.has(id)) continue
    const category = categorizeOsmTags(tags)
    if (!isWorthVisiting(el, category)) continue
    seenIds.add(id)
    const kept: Record<string, string> = {}
    for (const k of KEPT_TAG_KEYS) if (tags[k]) kept[k] = tags[k]
    const size = bboxDiagonalM(el)
    if (size > 0) kept.size_m = String(Math.round(size))
    out.push({
      id,
      name,
      lat: pos.lat,
      lng: pos.lng,
      category,
      distanceKm: haversineKm(center, pos),
      bearing: bearingDeg(center, pos),
      tags: kept,
      source: 'overpass',
    })
  }
  return out
}

export interface HedgeOptions {
  budgetMs: number
  hedgeDelayMs: number
  signal?: AbortSignal
}

/**
 * 複数エンドポイントを「時間予算内でヘッジ」して試す（BACKLOG A1）。
 * 1 本目を投げ、失敗するか hedgeDelayMs 経っても返らなければ次を並列で投げる。最初の成功を採用し残りは中断。
 * 予算切れは TimeoutError、呼び出し元の abort は AbortError。
 */
export function hedgeEndpoints<T>(
  endpoints: readonly string[],
  run: (endpoint: string, signal: AbortSignal, deadline: number) => Promise<T>,
  { budgetMs, hedgeDelayMs, signal }: HedgeOptions,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    if (endpoints.length === 0) return reject(new Error('No Overpass endpoints configured'))
    const ac = new AbortController()
    const deadline = Date.now() + budgetMs
    let next = 0
    let active = 0
    let settled = false
    let lastError: unknown = null
    const timers: ReturnType<typeof setTimeout>[] = []
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      timers.forEach(clearTimeout)
      signal?.removeEventListener('abort', onAbort)
      ac.abort()
      fn()
    }
    const onAbort = () => finish(() => reject(abortError()))
    signal?.addEventListener('abort', onAbort, { once: true })
    timers.push(setTimeout(() => finish(() => reject(new TimeoutError(budgetMs))), budgetMs))
    const launch = () => {
      if (settled || next >= endpoints.length) return
      const ep = endpoints[next++]
      active++
      run(ep, ac.signal, deadline).then(
        (v) => finish(() => resolve(v)),
        (e) => {
          active--
          if (settled) return
          if (!isAbortError(e)) {
            lastError = e
            console.warn(`[overpass] ${ep} failed`, e)
          }
          if (next < endpoints.length) launch()
          else if (active === 0) finish(() => reject(lastError ?? new Error('All Overpass endpoints failed')))
        },
      )
    }
    launch()
    timers.push(setTimeout(launch, hedgeDelayMs))
  })
}

export interface OverpassProviderOptions {
  endpoints?: readonly string[]
  budgetMs?: number
  hedgeDelayMs?: number
  firstTimeoutMs?: number
  maxRetryAfterS?: number
}

export function createOverpassProvider({
  endpoints = OVERPASS_ENDPOINTS,
  budgetMs = OVERPASS_BUDGET_MS,
  hedgeDelayMs = OVERPASS_HEDGE_DELAY_MS,
  firstTimeoutMs = OVERPASS_FIRST_TIMEOUT_MS,
  maxRetryAfterS = OVERPASS_MAX_RETRY_AFTER_S,
}: OverpassProviderOptions = {}): PlaceProvider {
  return {
    name: 'overpass',
    async search(center, _minKm, maxKm, signal) {
      const query = buildOverpassQuery(center, maxKm)
      // application/x-www-form-urlencoded の POST は CORS の simple request（プリフライト無し）
      const body = new URLSearchParams({ data: query }).toString()
      const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
      const attempt = async (endpoint: string, s: AbortSignal, deadline: number, retried = false): Promise<Place[]> => {
        const remaining = deadline - Date.now()
        try {
          const json = await fetchJson<OverpassResponse>(endpoint, init, { signal: s, timeoutMs: Math.max(1, Math.min(firstTimeoutMs, remaining)) })
          checkOverpassRemark(json)
          return parseOverpassElements(json.elements ?? [], center)
        } catch (e) {
          // 429/504: Retry-After が短く予算内なら、同一エンドポイントに 1 回だけ待ってから再試行
          if (
            !retried &&
            e instanceof HttpError &&
            (e.status === 429 || e.status === 504) &&
            e.retryAfterSec !== undefined &&
            e.retryAfterSec <= maxRetryAfterS &&
            e.retryAfterSec * 1000 < deadline - Date.now() - 1000
          ) {
            await sleep(e.retryAfterSec * 1000, s)
            return attempt(endpoint, s, deadline, true)
          }
          throw e
        }
      }
      return hedgeEndpoints(endpoints, (ep, s, deadline) => attempt(ep, s, deadline), { budgetMs, hedgeDelayMs, signal })
    },
  }
}
