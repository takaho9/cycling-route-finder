import { describe, expect, it } from 'vitest'
import { bearingSector } from '../geo'
import { CATEGORIES } from '../types'
import { createMockProvider, generateMockPlaces, mockTerrainElevation } from './mock'

const C = { lat: 35.681236, lng: 139.767125 }

describe('mock provider', () => {
  it('is deterministic for the same input', () => {
    expect(generateMockPlaces(C, 2, 4)).toEqual(generateMockPlaces(C, 2, 4))
  })
  it('differs for different centers', () => {
    expect(generateMockPlaces(C, 2, 4)[0].name).not.toBe(generateMockPlaces({ lat: 34.7, lng: 135.5 }, 2, 4)[0].name)
  })
  it('places are within the donut, uniquely named, mixed categories, spread bearings', () => {
    const ps = generateMockPlaces(C, 2, 4)
    expect(ps.length).toBeGreaterThanOrEqual(20)
    expect(ps.length).toBeLessThanOrEqual(40)
    for (const p of ps) {
      expect(p.distanceKm).toBeGreaterThanOrEqual(2 - 1e-6)
      expect(p.distanceKm).toBeLessThanOrEqual(4 + 1e-6)
      expect(CATEGORIES).toContain(p.category)
      expect(p.source).toBe('mock')
      expect(p.elevation).toBeDefined()
      expect(p.elevation!.profile).toHaveLength(10)
    }
    expect(new Set(ps.map((p) => p.name)).size).toBe(ps.length)
    expect(new Set(ps.map((p) => p.id)).size).toBe(ps.length)
    expect(new Set(ps.map((p) => p.category)).size).toBeGreaterThanOrEqual(8)
    expect(new Set(ps.map((p) => bearingSector(p.bearing))).size).toBe(8)
  })
  it('names look Japanese', () => {
    const names = generateMockPlaces(C, 2, 4).map((p) => p.name)
    expect(names.some((n) => /公園|緑地/.test(n))).toBe(true)
    expect(names.some((n) => /展望|見晴らし|の丘/.test(n))).toBe(true)
    expect(names.some((n) => /珈琲|カフェ|喫茶|COFFEE/.test(n))).toBe(true)
  })
  it('mock terrain is finite and non-negative', () => {
    for (let i = 0; i < 50; i++) {
      const v = mockTerrainElevation({ lat: 35 + i * 0.01, lng: 139 + i * 0.013 })
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
    }
  })
  it('provider honors abort', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(createMockProvider().search(C, 1, 2, ac.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
