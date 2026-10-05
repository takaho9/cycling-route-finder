/**
 * 事前生成だけで行う品質ルール（v1.3.2）。名前ベースのルール（チェーン・付属建物）は
 * src/lib/places/quality.ts（実行時の isWorthVisiting と共通）にある。
 *
 * 1. 境内の吸収: 大きな寺社（way/relation）の範囲内にある寺社 node（wikidata なし）は親に吸収する
 * 2. チェーンの自動判定: 同じ名前のカフェ・パン・甘味が都内に 5 件以上 → チェーンとして除外
 * 3. 名前ルールを Wikidata だけの項目にも当てる（OSM 側は isWorthVisiting で済んでいる）
 * 4. 小さな寺社（単独 node・wikidata も heritage も無し）は除外する（PdM 判断 A。境内を持つ way/relation は残す）
 */
import { haversineKm } from '../../src/lib/geo'
import { isChainName, isWorshipPartName, normalizeForMatch } from '../../src/lib/places/quality'
import type { PoiDraft } from './merge'

/** 同名チェーンとみなす件数 */
export const AUTO_CHAIN_MIN_COUNT = 5
/** 小さな寺社のスコア減点 */
export const MINOR_WORSHIP_PENALTY = 1.5
/** extent の無い（Overpass フォールバックの）境内は、中心からこの距離以内を境内とみなす (km) */
export const PRECINCT_FALLBACK_KM = 0.04

const FOOD = new Set(['cafe', 'bakery', 'sweets'])

/** 支店名などを落とした「店の名前」（例: "喫茶 ひだまり 新宿店" → "喫茶ひだまり"） */
export function shopBaseName(name: string): string {
  const raw = name.normalize('NFKC').replace(/[(（][^)）]*[)）]/g, ' ').trim()
  const parts = raw.split(/\s+/)
  if (parts.length > 1 && /(店|号店|支店|本店|branch|shop)$/i.test(parts[parts.length - 1])) parts.pop()
  return normalizeForMatch(parts.join(''))
}

export interface QualityStats {
  chainByName: number
  chainAuto: number
  autoChainNames: string[]
  worshipPart: number
  absorbed: number
  minorWorship: number
}

export function isMinorWorship(d: PoiDraft): boolean {
  return d.category === 'shrine' && d.id.startsWith('osm:node/') && !d.tags.wikidata && !d.tags.heritage && !d.wdHeritage
}

function inside(p: { lat: number; lng: number }, parent: PoiDraft): boolean {
  const e = parent.extent
  if (e) return p.lat >= e.minlat && p.lat <= e.maxlat && p.lng >= e.minlon && p.lng <= e.maxlon
  return haversineKm(p, parent) <= PRECINCT_FALLBACK_KM
}

/** 1〜4 を適用 */
export function applyQualityRules(pois: readonly PoiDraft[], { autoChainMin = AUTO_CHAIN_MIN_COUNT } = {}): { pois: PoiDraft[]; stats: QualityStats } {
  const stats: QualityStats = { chainByName: 0, chainAuto: 0, autoChainNames: [], worshipPart: 0, absorbed: 0, minorWorship: 0 }
  // 3. 名前ルール（Wikidata だけの項目にも）
  let out = pois.filter((d) => {
    if (FOOD.has(d.category) && isChainName(d.name)) {
      stats.chainByName++
      return false
    }
    if (d.category === 'shrine' && !d.tags.wikidata && !d.tags.heritage && !d.wdHeritage && isWorshipPartName(d.name)) {
      stats.worshipPart++
      return false
    }
    return true
  })
  // 2. 同名 5 件以上 = チェーン
  const counts = new Map<string, number>()
  for (const d of out) if (FOOD.has(d.category)) counts.set(shopBaseName(d.name), (counts.get(shopBaseName(d.name)) ?? 0) + 1)
  const chains = new Set([...counts].filter(([k, n]) => k.length >= 2 && n >= autoChainMin).map(([k]) => k))
  stats.autoChainNames = [...chains].sort()
  out = out.filter((d) => {
    if (FOOD.has(d.category) && chains.has(shopBaseName(d.name))) {
      stats.chainAuto++
      return false
    }
    return true
  })
  // 1. 境内の吸収（wikidata のある node は独立した名所なので残す）
  const parents = out.filter((d) => d.category === 'shrine' && !d.id.startsWith('osm:node/') && !d.id.startsWith('wd:'))
  const grid = new Map<string, PoiDraft[]>()
  const cell = (lat: number, lng: number) => `${Math.floor(lat / 0.01)}:${Math.floor(lng / 0.01)}`
  for (const p of parents) {
    const e = p.extent ?? { minlat: p.lat, maxlat: p.lat, minlon: p.lng, maxlon: p.lng }
    for (let y = Math.floor(e.minlat / 0.01); y <= Math.floor(e.maxlat / 0.01); y++)
      for (let x = Math.floor(e.minlon / 0.01); x <= Math.floor(e.maxlon / 0.01); x++) grid.set(`${y}:${x}`, [...(grid.get(`${y}:${x}`) ?? []), p])
  }
  out = out.filter((d) => {
    if (d.category !== 'shrine' || !d.id.startsWith('osm:node/') || d.tags.wikidata) return true
    const parent = (grid.get(cell(d.lat, d.lng)) ?? []).find((p) => inside(d, p))
    if (!parent) return true
    stats.absorbed++
    if (d.tags.heritage && !parent.tags.heritage) parent.tags.heritage = d.tags.heritage
    return false
  })
  // 4. 単独 node の小さな寺社は除外（境内に吸収されなかった残り）
  stats.minorWorship = out.filter(isMinorWorship).length
  out = out.filter((d) => !isMinorWorship(d))
  return { pois: out, stats }
}

/** 小さな寺社の減点（4 で除外済みなので通常は 0。ルールを緩めたとき用に残す） */
export function qualityPenalty(d: PoiDraft): number {
  return isMinorWorship(d) ? MINOR_WORSHIP_PENALTY : 0
}
