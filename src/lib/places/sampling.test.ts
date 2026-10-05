import { describe, expect, it } from 'vitest'
import { destinationPoint } from '../geo'
import type { Category, Place } from '../types'
import { attractiveness, balancedSample, dedupeNearby, filterDonut } from './sampling'

const C = { lat: 35.68, lng: 139.76 }
const mk = (id: string, category: Category, bearing: number, extra: Partial<Place> = {}): Place => ({
  id,
  name: id,
  ...destinationPoint(C, bearing, 1),
  category,
  distanceKm: 1,
  bearing,
  source: 'overpass',
  ...extra,
})

describe('sampling', () => {
  it('filterDonut keeps [min, max]', () => {
    const ps = [0.5, 1, 2, 3, 3.1].map((d, i) => mk(`p${i}`, 'park', 0, { distanceKm: d }))
    expect(filterDonut(ps, 1, 3).map((p) => p.distanceKm)).toEqual([1, 2, 3])
  })

  it('dedupeNearby merges same name within 300 m, keeps the more attractive, keeps distant namesakes', () => {
    const a = mk('a', 'shrine', 0, { name: '八幡神社' })
    const b = mk('b', 'shrine', 0, { name: '八幡　神社', ...destinationPoint(a, 90, 0.2), tags: { wikidata: 'Q1' } })
    const far = mk('c', 'shrine', 0, { name: '八幡神社', ...destinationPoint(a, 90, 2) })
    expect(dedupeNearby([a, b, far]).map((p) => p.id)).toEqual(['b', 'c'])
  })

  it('attractiveness rewards wikidata, heritage, size and photos', () => {
    expect(attractiveness({})).toBe(0)
    expect(attractiveness({ tags: { wikidata: 'Q1', heritage: '2', size_m: '1500' } })).toBe(3 + 2 + 3)
    expect(attractiveness({ photoUrl: 'x' })).toBe(4)
  })

  it('returns all when under the limit', () => {
    expect(balancedSample([mk('a', 'park', 0, { score: 1 }), mk('b', 'cafe', 90)], 40)).toHaveLength(2)
  })

  it('balances categories when one category dominates', () => {
    const cafes = Array.from({ length: 100 }, (_, i) => mk(`cafe${String(i).padStart(3, '0')}`, 'cafe', (i * 37) % 360))
    const parks = Array.from({ length: 5 }, (_, i) => mk(`park${i}`, 'park', i * 70, { score: 2 }))
    const shrines = Array.from({ length: 5 }, (_, i) => mk(`shrine${i}`, 'shrine', i * 70, { score: 2 }))
    const out = balancedSample([...cafes, ...parks, ...shrines], 40)
    expect(out).toHaveLength(40)
    expect(out.filter((p) => p.category === 'park')).toHaveLength(5)
    expect(out.filter((p) => p.category === 'cafe')).toHaveLength(30)
  })

  it('v1.4 Q8: non-food places with score 0 are dropped before the split; cafes/bakeries/sweets are kept', () => {
    const out = balancedSample([mk('p0', 'park', 0), mk('p1', 'park', 10, { score: 3 }), mk('c0', 'cafe', 20), mk('h0', 'historic', 30, { tags: { wikidata: 'Q1' } })], 40)
    expect(out.map((p) => p.id).sort()).toEqual(['c0', 'h0', 'p1'])
  })

  it('v1.4 Q8: ties are broken by hash(id + date) — the order changes by day, deterministically', () => {
    const parks = Array.from({ length: 30 }, (_, i) => mk(`park${String(i).padStart(2, '0')}`, 'park', 0, { score: 1 }))
    const day = (k: string) => balancedSample(parks, 5, 8, { dateKey: k }).map((p) => p.id)
    expect(day('2026-10-05')).toEqual(day('2026-10-05'))
    expect(day('2026-10-05')).not.toEqual(day('2026-10-06'))
    expect(balancedSample(parks, 5).map((p) => p.id)).toEqual(['park00', 'park01', 'park02', 'park03', 'park04'])
  })

  it('spreads bearings within a category', () => {
    const north = Array.from({ length: 50 }, (_, i) => mk(`n${String(i).padStart(2, '0')}`, 'cafe', 1))
    const south = Array.from({ length: 5 }, (_, i) => mk(`s${i}`, 'cafe', 180))
    expect(balancedSample([...north, ...south], 10).filter((p) => p.bearing === 180)).toHaveLength(5)
  })

  it('prefers attractive places and is deterministic', () => {
    const ps = Array.from({ length: 20 }, (_, i) => mk(`p${String(i).padStart(2, '0')}`, 'park', 0))
    ps[17] = { ...ps[17], tags: { wikidata: 'Q1' } }
    const a = balancedSample(ps, 3)
    expect(a[0].id).toBe('p17')
    expect(balancedSample([...ps].reverse(), 3)).toEqual(a)
  })
})
