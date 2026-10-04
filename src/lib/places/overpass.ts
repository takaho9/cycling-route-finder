import { bearingDeg, haversineKm } from '../geo'
import { fetchJson, isAbortError } from '../http'
import type { Category, LatLng, Place, PlaceProvider } from '../types'
import { balancedSample, dedupeByName, filterDonut, MAX_CANDIDATES } from './sampling'

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const

/** Overpass サーバ側タイムアウト (秒) */
export const OVERPASS_SERVER_TIMEOUT_S = 20
/** 1 エンドポイントあたりのクライアント側タイムアウト (ms) */
export const OVERPASS_CLIENT_TIMEOUT_MS = 22_000
/** クエリ内の 1 セレクタあたりの最大出力件数（レスポンス肥大化防止） */
export const OVERPASS_PER_SELECTOR_LIMIT = 120
/** 公園の最小規模: バウンディングボックス対角 (m)。ノードのみの公園は小規模とみなして除外 */
export const MIN_PARK_BBOX_DIAGONAL_M = 150
/** 名前から小規模と判断する公園 */
export const SMALL_PARK_NAME_RE = /児童遊園|ちびっこ|児童公園|ポケットパーク|遊び場|プチテラス/
/** 水辺っぽい公園名 → waterside に寄せる */
const WATERSIDE_NAME_RE = /河川敷|親水|水辺|海浜|湖畔|川沿い|ビーチ|浜/

/**
 * 取得するセレクタ。`nwr` は way/relation を含むため重い。nodes で十分なものは `node`。
 * waterway=riverbank 等の巨大ポリゴンは重いので避け、名前付き水面・ビーチ・マリーナに限定。
 */
export const OVERPASS_SELECTORS: readonly string[] = [
  'wr["leisure"="park"]["name"]',
  'nwr["leisure"="garden"]["name"]["access"!~"private|no"]',
  'node["tourism"="viewpoint"]["name"]',
  'node["amenity"="cafe"]["name"]',
  'node["shop"="bakery"]["name"]',
  'nwr["amenity"="place_of_worship"]["name"]',
  'nwr["historic"]["name"]["historic"!~"^(memorial|boundary_stone|milestone|wayside_shrine)$"]',
  'nwr["natural"="beach"]["name"]',
  'wr["natural"="water"]["name"]["water"~"^(lake|pond|reservoir)$"]',
  'nwr["leisure"="marina"]["name"]',
  'nwr["tourism"="attraction"]["name"]',
  'nwr["highway"~"^(services|rest_area)$"]["name"~"道の駅"]',
]

/** around 検索を差集合でドーナツ化したクエリを組み立てる */
export function buildOverpassQuery(center: LatLng, minKm: number, maxKm: number): string {
  const lat = center.lat.toFixed(6)
  const lng = center.lng.toFixed(6)
  const rOut = Math.round(maxKm * 1000)
  const rIn = Math.round(minKm * 1000)
  // NOTE: `out tags` だと node の座標が出ないため body を使う。bb で way/relation の bounds を得る
  const blocks = OVERPASS_SELECTORS.map((sel, i) => {
    const outer = `${sel}(around:${rOut},${lat},${lng})`
    const set =
      rIn > 0 ? `(${outer}; - ${sel}(around:${rIn},${lat},${lng});)->.s${i};` : `${outer}->.s${i};`
    return `${set}\n.s${i} out body bb ${OVERPASS_PER_SELECTOR_LIMIT};`
  })
  return `[out:json][timeout:${OVERPASS_SERVER_TIMEOUT_S}];\n${blocks.join('\n')}`
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

/** OSM タグからカテゴリ判定 */
export function categorizeOsmTags(tags: Record<string, string>): Category {
  const name = tags.name ?? ''
  if (/道の駅/.test(name) || tags.highway === 'services' || tags.highway === 'rest_area') return 'roadside_station'
  if (tags.tourism === 'viewpoint') return 'viewpoint'
  if (tags.amenity === 'cafe') return 'cafe'
  if (tags.shop === 'bakery') return 'bakery'
  if (tags.amenity === 'place_of_worship') return 'shrine'
  if (tags.natural === 'beach' || tags.natural === 'water' || tags.leisure === 'marina') return 'waterside'
  if (tags.leisure === 'park' || tags.leisure === 'garden') return WATERSIDE_NAME_RE.test(name) ? 'waterside' : 'park'
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

/** 小規模公園などノイズを除外 */
function isWorthVisiting(el: OverpassElement, category: Category): boolean {
  const tags = el.tags ?? {}
  if (category === 'park') {
    if (SMALL_PARK_NAME_RE.test(tags.name ?? '')) return false
    if (el.type === 'node') return false
    if (bboxDiagonalM(el) < MIN_PARK_BBOX_DIAGONAL_M) return false
  }
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

export interface OverpassProviderOptions {
  endpoints?: readonly string[]
  timeoutMs?: number
  maxResults?: number
}

export function createOverpassProvider({
  endpoints = OVERPASS_ENDPOINTS,
  timeoutMs = OVERPASS_CLIENT_TIMEOUT_MS,
  maxResults = MAX_CANDIDATES,
}: OverpassProviderOptions = {}): PlaceProvider {
  return {
    name: 'overpass',
    async search(center, minKm, maxKm, signal) {
      const query = buildOverpassQuery(center, minKm, maxKm)
      // application/x-www-form-urlencoded の POST は CORS の simple request（プリフライト無し）
      const body = new URLSearchParams({ data: query }).toString()
      let lastError: unknown = new Error('No Overpass endpoints configured')
      for (const endpoint of endpoints) {
        try {
          const json = await fetchJson<{ elements?: OverpassElement[] }>(
            endpoint,
            { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
            { signal, timeoutMs },
          )
          const places = parseOverpassElements(json.elements ?? [], center)
          return balancedSample(dedupeByName(filterDonut(places, minKm, maxKm)), maxResults)
        } catch (e) {
          if (isAbortError(e) && signal?.aborted) throw e
          console.warn(`[overpass] ${endpoint} failed`, e)
          lastError = e
        }
      }
      throw lastError
    },
  }
}
