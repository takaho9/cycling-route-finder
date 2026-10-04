import { describe, expect, it } from 'vitest'
import type { Category, Place } from '../types'
import { balancedSample, dedupeByName, filterDonut } from './sampling'

const mk = (id: string, category: Category, bearing: number, extra: Partial<Place> = {}): Place => ({
  id,
  name: id,
  lat: 0,
  lng: 0,
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

  it('dedupeByName normalizes width and spaces', () => {
    const ps = [mk('a', 'cafe', 0, { name: 'ドトール コーヒー' }), mk('b', 'cafe', 0, { name: 'ドトール　コーヒー' }), mk('c', 'cafe', 0, { name: 'ＡＢＣ' }), mk('d', 'cafe', 0, { name: 'abc' })]
    expect(dedupeByName(ps).map((p) => p.id)).toEqual(['a', 'c'])
  })

  it('returns all when under the limit', () => {
    const ps = [mk('a', 'park', 0), mk('b', 'cafe', 90)]
    expect(balancedSample(ps, 40)).toHaveLength(2)
  })

  it('balances categories when one category dominates', () => {
    const cafes = Array.from({ length: 100 }, (_, i) => mk(`cafe${String(i).padStart(3, '0')}`, 'cafe', (i * 37) % 360))
    const parks = Array.from({ length: 5 }, (_, i) => mk(`park${i}`, 'park', i * 70))
    const shrines = Array.from({ length: 5 }, (_, i) => mk(`shrine${i}`, 'shrine', i * 70))
    const out = balancedSample([...cafes, ...parks, ...shrines], 40)
    expect(out).toHaveLength(40)
    expect(out.filter((p) => p.category === 'park')).toHaveLength(5)
    expect(out.filter((p) => p.category === 'shrine')).toHaveLength(5)
    expect(out.filter((p) => p.category === 'cafe')).toHaveLength(30)
  })

  it('spreads bearings within a category', () => {
    // 50 cafes to the north, 5 to the south: the south ones must all be picked
    const north = Array.from({ length: 50 }, (_, i) => mk(`n${String(i).padStart(2, '0')}`, 'cafe', 1))
    const south = Array.from({ length: 5 }, (_, i) => mk(`s${i}`, 'cafe', 180))
    const out = balancedSample([...north, ...south], 10)
    expect(out.filter((p) => p.bearing === 180)).toHaveLength(5)
  })

  it('prefers places with photo hints and is deterministic', () => {
    const ps = Array.from({ length: 20 }, (_, i) => mk(`p${String(i).padStart(2, '0')}`, 'park', 0))
    ps[17] = { ...ps[17], tags: { wikidata: 'Q1' } }
    const a = balancedSample(ps, 3)
    expect(a[0].id).toBe('p17')
    expect(balancedSample([...ps].reverse(), 3)).toEqual(a)
  })
})
