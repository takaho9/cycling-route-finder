import { bearingSector } from '../geo'
import type { Place } from '../types'

export const MAX_CANDIDATES = 40

/** ドーナツ領域 (minKm <= d <= maxKm) に入る候補だけ残す */
export function filterDonut<T extends Pick<Place, 'distanceKm'>>(places: readonly T[], minKm: number, maxKm: number): T[] {
  return places.filter((p) => p.distanceKm >= minKm && p.distanceKm <= maxKm)
}

/** 同名（チェーン店・同じ公園の複数ノード等）を 1 件に */
export function dedupeByName<T extends Pick<Place, 'name'>>(places: readonly T[]): T[] {
  const seen = new Set<string>()
  return places.filter((p) => {
    const k = p.name.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** 写真が出せそうなもの・情報の多いものを優先するスコア */
function richness(p: Place): number {
  const t = p.tags ?? {}
  let s = 0
  if (p.photoUrl) s += 4
  if (t.image || t.wikimedia_commons) s += 3
  if (t.wikidata) s += 2
  if (t.wikipedia) s += 1
  return s
}

/**
 * カテゴリと方位が偏らないように最大 max 件を選ぶ。
 * カテゴリ間ラウンドロビン → 各カテゴリ内では方位セクタ間ラウンドロビン。
 * 各バケット内は richness 降順 → id 昇順で決定的。
 */
export function balancedSample(places: readonly Place[], max = MAX_CANDIDATES, sectors = 8): Place[] {
  if (places.length <= max) return [...places]
  const byCat = new Map<string, Map<number, Place[]>>()
  for (const p of places) {
    const sec = bearingSector(p.bearing, sectors)
    let m = byCat.get(p.category)
    if (!m) byCat.set(p.category, (m = new Map()))
    const arr = m.get(sec) ?? []
    arr.push(p)
    m.set(sec, arr)
  }
  const cmp = (a: Place, b: Place) => richness(b) - richness(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  // カテゴリごとに「方位ラウンドロビン順」に並べたキューを作る
  const queues: Place[][] = [...byCat.keys()].sort().map((cat) => {
    const secMap = byCat.get(cat)!
    const buckets = [...secMap.keys()].sort((a, b) => a - b).map((k) => secMap.get(k)!.sort(cmp))
    const q: Place[] = []
    for (let i = 0; buckets.some((b) => i < b.length); i++) {
      for (const b of buckets) if (i < b.length) q.push(b[i])
    }
    return q
  })
  const out: Place[] = []
  for (let i = 0; out.length < max && queues.some((q) => i < q.length); i++) {
    for (const q of queues) {
      if (i < q.length && out.length < max) out.push(q[i])
    }
  }
  return out
}
