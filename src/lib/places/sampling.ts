import { bearingSector, haversineKm } from '../geo'
import { hashString } from '../random'
import type { Place } from '../types'

export const MAX_CANDIDATES = 40
/** 同名とみなして統合する距離 (km) */
export const DEDUPE_RADIUS_KM = 0.3

/** ドーナツ領域 (minKm <= d <= maxKm) に入る候補だけ残す */
export function filterDonut<T extends Pick<Place, 'distanceKm'>>(places: readonly T[], minKm: number, maxKm: number): T[] {
  return places.filter((p) => p.distanceKm >= minKm && p.distanceKm <= maxKm)
}

const normName = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase()

/**
 * 「同名かつ 300m 以内」を 1 件に（同じ公園の複数要素など）。見栄えスコアの高い方を残す。
 * 離れた同名（別の「八幡神社」等）は残す。
 */
export function dedupeNearby<T extends Pick<Place, 'name' | 'lat' | 'lng' | 'id'> & Partial<Pick<Place, 'tags' | 'photoUrl' | 'score'>>>(
  places: readonly T[],
  radiusKm = DEDUPE_RADIUS_KM,
): T[] {
  const sorted = [...places].sort((a, b) => attractiveness(b) - attractiveness(a) || cmpId(a, b))
  const kept: T[] = []
  const byName = new Map<string, T[]>()
  for (const p of sorted) {
    const k = normName(p.name)
    const same = byName.get(k) ?? []
    if (same.some((q) => haversineKm(p, q) <= radiusKm)) continue
    same.push(p)
    byName.set(k, same)
    kept.push(p)
  }
  const order = new Map(places.map((p, i) => [p.id, i]))
  return kept.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
}

const cmpId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * 見栄えスコア（wikidata, 面積, heritage, 写真の手がかり）。
 * 事前生成データ（static）は生成時に計算した score（sitelinks・埋め込み写真も加味）を使う。
 */
export function attractiveness(p: Partial<Pick<Place, 'tags' | 'photoUrl' | 'score'>>): number {
  if (typeof p.score === 'number' && Number.isFinite(p.score)) return p.score
  const t = p.tags ?? {}
  let s = 0
  if (p.photoUrl) s += 4
  if (t.wikimedia_commons || t.image) s += 3
  if (t.wikidata) s += 3
  if (t.heritage) s += 2
  if (t.wikipedia) s += 1
  const size = Number(t.size_m)
  if (Number.isFinite(size) && size > 0) s += Math.min(3, size / 500)
  return s
}

/** 飲食（カフェ・パン・甘味）はスコア 0 でも候補に残す（店はタグが少なくても行き先になる） */
export const FOOD_CATEGORIES: ReadonlySet<string> = new Set(['cafe', 'bakery', 'sweets'])

/** 候補にしてよいか（v1.4 Q8）: 飲食以外はスコア 0 を除く */
export function isCandidateWorthy(p: Pick<Place, 'category'> & Partial<Pick<Place, 'tags' | 'photoUrl' | 'score'>>): boolean {
  return FOOD_CATEGORIES.has(p.category) || attractiveness(p) > 0
}

export interface BalancedSampleOptions {
  /** 同点の並びを日替わりにする日付キー（v1.4 Q8）。無ければ id 順 */
  dateKey?: string
}

/**
 * カテゴリと方位が偏らないように最大 max 件を選ぶ。
 * カテゴリ間ラウンドロビン → 各カテゴリ内では方位セクタ間ラウンドロビン。
 * 飲食以外はスコア 0 を除いてから割り当てる（v1.4 Q8）。
 * 各バケット内は見栄えスコア降順 → 同点は hash(id+日付)（日替わり）→ id 昇順で決定的。
 */
export function balancedSample(places: readonly Place[], max = MAX_CANDIDATES, sectors = 8, { dateKey }: BalancedSampleOptions = {}): Place[] {
  const worthy = places.filter(isCandidateWorthy)
  if (worthy.length <= max) return [...worthy]
  const tie = (p: Place) => (dateKey ? hashString(`${p.id}|${dateKey}`) : 0)
  const byCat = new Map<string, Map<number, Place[]>>()
  for (const p of worthy) {
    const sec = bearingSector(p.bearing, sectors)
    let m = byCat.get(p.category)
    if (!m) byCat.set(p.category, (m = new Map()))
    const arr = m.get(sec) ?? []
    arr.push(p)
    m.set(sec, arr)
  }
  const cmp = (a: Place, b: Place) => attractiveness(b) - attractiveness(a) || tie(a) - tie(b) || cmpId(a, b)
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
