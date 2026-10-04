import { looksLikeWaterCrossing } from './elevation'
import { attractiveness, balancedSample, dedupeNearby, filterDonut, MAX_CANDIDATES } from './places/sampling'
import { hashString, mulberry32, shuffle } from './random'
import { computeReach } from './reach'
import type { Category, ElevationLabel, Place } from './types'

/**
 * 全候補（1 回の検索結果）から、選んだ時間・速度のドーナツに入るものを選ぶ（R6: 再検索しない）。
 */
export function selectCandidates(all: readonly Place[], roundTripMin: number, speedKmh: number, max = MAX_CANDIDATES): Place[] {
  const r = computeReach(roundTripMin, speedKmh)
  return balancedSample(dedupeNearby(filterDonut(all, r.minKm, r.bandMaxKm)), max)
}

export type ElevationFilter = 'all' | ElevationLabel
export type SortKey = 'near' | 'far' | 'flat' | 'random' | 'unvisited'

export const SORT_LABELS: Record<SortKey, string> = {
  near: '近い順',
  far: '遠い順',
  flat: '平坦順',
  random: 'ランダム',
  unvisited: '行ったことない順',
}

export interface FilterOptions {
  elevation: ElevationFilter
  /** 空集合 = すべて */
  categories: ReadonlySet<Category>
  sort: SortKey
  visited: ReadonlySet<string>
  /** ランダム順のシード */
  seed?: number
}

const LABEL_ORDER: Record<ElevationLabel, number> = { flat: 0, rolling: 1, hilly: 2 }

/**
 * フィルタ＋並び替え（純粋関数）。
 * - 高低差フィルタ: 標高未取得の候補は「全部」以外では除外
 * - 海上・水面を横切っていそうな候補は、どの並びでも後ろへ（R5）
 */
export function filterAndSort(places: readonly Place[], o: FilterOptions): Place[] {
  let list = places.filter(
    (p) => (o.elevation === 'all' || p.elevation?.label === o.elevation) && (o.categories.size === 0 || o.categories.has(p.category)),
  )
  const byDist = (a: Place, b: Place) => a.distanceKm - b.distanceKm
  switch (o.sort) {
    case 'near':
      list = [...list].sort(byDist)
      break
    case 'far':
      list = [...list].sort((a, b) => b.distanceKm - a.distanceKm)
      break
    case 'flat':
      list = [...list].sort((a, b) => {
        const la = a.elevation ? LABEL_ORDER[a.elevation.label] * 1000 + a.elevation.climbPerKm : Infinity
        const lb = b.elevation ? LABEL_ORDER[b.elevation.label] * 1000 + b.elevation.climbPerKm : Infinity
        return la - lb || byDist(a, b)
      })
      break
    case 'random':
      list = shuffle(mulberry32(o.seed ?? 1), list)
      break
    case 'unvisited':
      list = [...list].sort((a, b) => Number(o.visited.has(a.id)) - Number(o.visited.has(b.id)) || byDist(a, b))
      break
  }
  const dry = list.filter((p) => !looksLikeWaterCrossing(p.elevation))
  const wet = list.filter((p) => looksLikeWaterCrossing(p.elevation))
  return [...dry, ...wet]
}

/** 存在するカテゴリ（フィルタチップ用、出現順） */
export function categoriesIn(places: readonly Place[]): Category[] {
  return [...new Set(places.map((p) => p.category))]
}

/**
 * 今日のおすすめ（日付シードで日替わり、未訪問に加点、カテゴリ重複なし）。
 */
export function pickRecommendations(
  places: readonly Place[],
  { dateKey, visited, count = 3 }: { dateKey: string; visited: ReadonlySet<string>; count?: number },
): Place[] {
  const scored = places
    .map((p) => {
      const daily = hashString(`${dateKey}|${p.id}`) / 2 ** 32
      const score =
        daily +
        (visited.has(p.id) ? 0 : 0.6) +
        Math.min(0.5, attractiveness(p) * 0.05) -
        (looksLikeWaterCrossing(p.elevation) ? 2 : 0)
      return { p, score }
    })
    .sort((a, b) => b.score - a.score || (a.p.id < b.p.id ? -1 : 1))
  const out: Place[] = []
  const usedCats = new Set<Category>()
  for (const { p } of scored) {
    if (out.length >= count) break
    if (usedCats.has(p.category)) continue
    usedCats.add(p.category)
    out.push(p)
  }
  for (const { p } of scored) {
    if (out.length >= count) break
    if (!out.includes(p)) out.push(p)
  }
  return out
}

/** ガチャ: 直前の結果を除いてランダムに 1 件 */
export function pickGacha(places: readonly Place[], excludeId: string | null, rng: () => number = Math.random): Place | null {
  const pool = places.length > 1 && excludeId ? places.filter((p) => p.id !== excludeId) : places
  if (pool.length === 0) return null
  return pool[Math.floor(rng() * pool.length) % pool.length]
}
