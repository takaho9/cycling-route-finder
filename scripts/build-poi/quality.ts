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
import { hasJapanese, isChainName, isNotDestination, isSmallMonumentName, isWorshipPartName, normalizeForMatch } from '../../src/lib/places/quality'
import { similarName } from './merge'
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
  notDestination: number
  smallMonument: number
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

/** 大きな公園とみなす範囲の対角 (m) */
export const LARGE_PARK_DIAGONAL_M = 300

type ParentKind = 'precinct' | 'zoo' | 'park'
function parentKind(d: PoiDraft): ParentKind | null {
  if (d.id.startsWith('osm:node/') || d.id.startsWith('wd:')) return null
  if (d.tags.tourism === 'zoo' || d.tags.tourism === 'theme_park') return 'zoo'
  if (d.category === 'shrine') return 'precinct'
  const leisurePark = d.tags.leisure === 'park' || d.tags.leisure === 'garden'
  if (leisurePark && Number(d.tags.size_m) >= LARGE_PARK_DIAGONAL_M) return 'park'
  return null
}

function absorbs(parent: PoiDraft, child: PoiDraft): boolean {
  const kind = parentKind(parent)
  // 境内: 中の寺社 node、資料館、奉納所などの見どころ・史跡・池（v1.4 Q6）
  if (kind === 'precinct')
    return (child.category === 'shrine' && child.id.startsWith('osm:node/')) || ['museum', 'attraction', 'historic', 'waterside'].includes(child.category)
  if (kind === 'zoo' || kind === 'park') return ['attraction', 'waterside', 'historic'].includes(child.category) && !parentKind(child)
  return false
}

const diag = (e: NonNullable<PoiDraft['extent']>) => Math.hypot(e.maxlat - e.minlat, (e.maxlon - e.minlon) * 0.81)
function smaller(child: PoiDraft, parent: PoiDraft): boolean {
  if (!child.extent) return true
  if (!parent.extent) return false
  return diag(child.extent) < diag(parent.extent)
}

function inside(p: { lat: number; lng: number }, parent: PoiDraft): boolean {
  const e = parent.extent
  if (e) return p.lat >= e.minlat && p.lat <= e.maxlat && p.lng >= e.minlon && p.lng <= e.maxlon
  return haversineKm(p, parent) <= PRECINCT_FALLBACK_KM
}

/** 1〜4 を適用 */
export function applyQualityRules(pois: readonly PoiDraft[], { autoChainMin = AUTO_CHAIN_MIN_COUNT } = {}): { pois: PoiDraft[]; stats: QualityStats } {
  const stats: QualityStats = { notDestination: 0, smallMonument: 0, chainByName: 0, chainAuto: 0, autoChainNames: [], worshipPart: 0, absorbed: 0, minorWorship: 0 }
  // 3. 名前ルール（Wikidata だけの項目にも）
  let out = pois.filter((d) => {
    // 目的地にならないもの・立入不可（v1.4 Q3。Wikidata だけの項目にも）
    if (isNotDestination(d.name, d.tags.wikidata)) {
      stats.notDestination++
      return false
    }
    // 小さな史跡（v1.4 Q11）: 碑・塔・像・墓・台座跡で終わる node（wikidata も heritage も無し）
    if ((d.category === 'historic' || d.category === 'attraction') && d.id.startsWith('osm:node/') && !d.tags.wikidata && !d.tags.heritage && !d.wdHeritage && isSmallMonumentName(d.name)) {
      stats.smallMonument++
      return false
    }
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
  // 1. 境内・園内の吸収（wikidata / heritage のあるものは独立した名所なので残す）
  //   - 寺社の境内（way/relation）: 中の寺社 node・資料館（v1.3.2 / v1.4 Q6）
  //   - 動物園・テーマパーク・大きな公園: 中の見どころ・水辺・史跡（v1.4 Q2 / Q6）
  const parents = out.filter((d) => parentKind(d))
  const grid = new Map<string, PoiDraft[]>()
  const cell = (lat: number, lng: number) => `${Math.floor(lat / 0.01)}:${Math.floor(lng / 0.01)}`
  for (const p of parents) {
    const e = p.extent ?? { minlat: p.lat, maxlat: p.lat, minlon: p.lng, maxlon: p.lng }
    for (let y = Math.floor(e.minlat / 0.01); y <= Math.floor(e.maxlat / 0.01); y++)
      for (let x = Math.floor(e.minlon / 0.01); x <= Math.floor(e.maxlon / 0.01); x++) grid.set(`${y}:${x}`, [...(grid.get(`${y}:${x}`) ?? []), p])
  }
  out = out.filter((d) => {
    if (d.tags.wikidata || (d.tags.heritage && d.category !== 'shrine')) return true
    const parent = (grid.get(cell(d.lat, d.lng)) ?? []).find((p) => p !== d && absorbs(p, d) && inside(d, p) && smaller(d, p))
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

/**
 * 英語だけの名前の弱い候補（v1.4 Q9）: QID が無く、スコア 0、日本語を含まない、飲食以外 → 除外。
 * スコアの計算後に使う。
 */
export function dropWeakForeignNames(pois: readonly PoiDraft[]): { pois: PoiDraft[]; dropped: number } {
  const out = pois.filter((d) => FOOD.has(d.category) || d.tags.wikidata || (d.score ?? 0) > 0 || hasJapanese(d.name))
  return { pois: out, dropped: pois.length - out.length }
}

/** 60m 以内で名前が似ていれば、カテゴリが違っても 1 件に（スコアの高い方を残す, v1.4 Q6） */
export const NEAR_SIMILAR_KM = 0.06
export function mergeNearSimilar(pois: readonly PoiDraft[], radiusKm = NEAR_SIMILAR_KM): { pois: PoiDraft[]; merged: number } {
  const sorted = [...pois].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.id < b.id ? -1 : 1))
  const grid = new Map<string, PoiDraft[]>()
  const key = (y: number, x: number) => `${y}:${x}`
  const kept: PoiDraft[] = []
  for (const d of sorted) {
    const cy = Math.floor(d.lat / 0.001)
    const cx = Math.floor(d.lng / 0.001)
    let dup = false
    for (let y = cy - 1; y <= cy + 1 && !dup; y++)
      for (let x = cx - 1; x <= cx + 1 && !dup; x++)
        for (const k of grid.get(key(y, x)) ?? []) {
          if (haversineKm(d, k) <= radiusKm && similarName(d.name, k.name)) {
            dup = true
            break
          }
        }
    if (dup) continue
    kept.push(d)
    grid.set(key(cy, cx), [...(grid.get(key(cy, cx)) ?? []), d])
  }
  const ids = new Set(kept.map((d) => d.id))
  return { pois: pois.filter((d) => ids.has(d.id)), merged: pois.length - kept.length }
}
