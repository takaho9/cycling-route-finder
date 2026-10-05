import { describe, expect, it } from 'vitest'
import { filterAndSort, pickGacha, pickRecommendations, selectCandidates } from './candidates'
import { summarizeElevation } from './elevation'
import { computeReach } from './reach'
import type { Category, ElevationSummary, Place } from './types'

const elev = (profile: number[], km = 4): ElevationSummary => summarizeElevation(profile, km)
const FLAT = elev([10, 10, 11, 10])
const ROLLING = elev([10, 25, 40, 50]) // G=40 → ゆる
const HILLY = elev([10, 60, 120, 170]) // G=160 → ヒル
const SEA = elev([5, 0, 0, 0, 5])

let n = 0
const P = (over: Partial<Place> & { category?: Category } = {}): Place => ({
  id: `p${++n}`,
  name: `場所${n}`,
  lat: 35.7,
  lng: 139.7,
  category: 'park',
  distanceKm: 3,
  bearing: 0,
  source: 'overpass',
  ...over,
})

describe('selectCandidates (R6: client-side only)', () => {
  it('keeps only the 0.7–1.0 donut of the chosen time × speed', () => {
    const r = computeReach(45, 16)
    const all = [0.5, r.minKm - 0.01, r.minKm + 0.01, r.bandMaxKm - 0.01, r.bandMaxKm + 0.01].map((d) => P({ distanceKm: d }))
    expect(selectCandidates(all, 45, 16).map((p) => p.distanceKm)).toEqual([r.minKm + 0.01, r.bandMaxKm - 0.01])
  })
})

describe('filterAndSort', () => {
  const visited = new Set<string>()
  const base = { categories: new Set<Category>(), visited, sort: 'near' as const }

  it('elevation filter matches the label; unknown elevation only in "all"', () => {
    const list = [P({ elevation: FLAT }), P({ elevation: HILLY }), P()]
    expect(filterAndSort(list, { ...base, elevation: 'all' })).toHaveLength(3)
    expect(filterAndSort(list, { ...base, elevation: 'hilly' }).map((p) => p.elevation?.label)).toEqual(['hilly'])
    expect(filterAndSort(list, { ...base, elevation: 'flat' })).toHaveLength(1)
  })

  it('category filter is multi-select (empty = all)', () => {
    const list = [P({ category: 'cafe' }), P({ category: 'shrine' }), P({ category: 'park' })]
    expect(filterAndSort(list, { ...base, elevation: 'all', categories: new Set(['cafe', 'park']) }).map((p) => p.category)).toEqual(['cafe', 'park'])
  })

  it('sorts near / far / flat / unvisited; random is deterministic per seed', () => {
    const a = P({ distanceKm: 5, elevation: HILLY })
    const b = P({ distanceKm: 3, elevation: ROLLING })
    const c = P({ distanceKm: 4, elevation: FLAT })
    const list = [a, b, c]
    const ids = (s: Parameters<typeof filterAndSort>[1]) => filterAndSort(list, s).map((p) => p.id)
    expect(ids({ ...base, elevation: 'all', sort: 'near' })).toEqual([b.id, c.id, a.id])
    expect(ids({ ...base, elevation: 'all', sort: 'far' })).toEqual([a.id, c.id, b.id])
    expect(ids({ ...base, elevation: 'all', sort: 'flat' })).toEqual([c.id, b.id, a.id])
    expect(ids({ ...base, elevation: 'all', sort: 'unvisited', visited: new Set([b.id]) })).toEqual([c.id, a.id, b.id])
    expect(ids({ ...base, elevation: 'all', sort: 'random', seed: 7 })).toEqual(ids({ ...base, elevation: 'all', sort: 'random', seed: 7 }))
  })

  it('places that seem to cross water go last in any order (R5)', () => {
    const wet = P({ distanceKm: 1, elevation: SEA })
    const dry = P({ distanceKm: 9, elevation: FLAT })
    expect(filterAndSort([wet, dry], { ...base, elevation: 'all', sort: 'near' }).map((p) => p.id)).toEqual([dry.id, wet.id])
  })
})

describe('pickRecommendations (daily, unvisited first, varied)', () => {
  const cats: Category[] = ['park', 'cafe', 'shrine', 'park', 'cafe', 'shrine', 'museum', 'bakery']
  const list = cats.map((category) => P({ category }))

  it('is stable within a day and changes across days', () => {
    const a = pickRecommendations(list, { dateKey: '2026-10-07', visited: new Set() })
    const b = pickRecommendations(list, { dateKey: '2026-10-07', visited: new Set() })
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id))
    const days = ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'].map((d) =>
      pickRecommendations(list, { dateKey: d, visited: new Set() })
        .map((p) => p.id)
        .join(),
    )
    expect(new Set([a.map((p) => p.id).join(), ...days]).size).toBeGreaterThan(1)
  })

  it('returns 3 places of different categories when possible', () => {
    const r = pickRecommendations(list, { dateKey: '2026-10-07', visited: new Set() })
    expect(r).toHaveLength(3)
    expect(new Set(r.map((p) => p.category)).size).toBe(3)
  })

  it('prefers unvisited places and demotes water crossings', () => {
    const visited = new Set(list.slice(0, 6).map((p) => p.id))
    const r = pickRecommendations(list, { dateKey: '2026-10-07', visited })
    expect(r.filter((p) => !visited.has(p.id)).length).toBeGreaterThanOrEqual(2)
    const wet = P({ category: 'seaside', elevation: SEA })
    expect(pickRecommendations([...list, wet], { dateKey: '2026-10-07', visited: new Set() }).map((p) => p.id)).not.toContain(wet.id)
  })
})

describe('pickGacha', () => {
  it('excludes the previous result unless it is the only one', () => {
    const list = [P(), P()]
    expect(pickGacha(list, list[0].id, () => 0)?.id).toBe(list[1].id)
    expect(pickGacha([list[0]], list[0].id, () => 0)?.id).toBe(list[0].id)
    expect(pickGacha([], null)).toBeNull()
  })
})
