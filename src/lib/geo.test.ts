import { describe, expect, it } from 'vitest'
import {
  bearingDeg,
  bearingSector,
  bearingToCompassJa,
  destinationPoint,
  haversineKm,
  interpolateLine,
  polylineLengthKm,
  samplePolyline,
} from './geo'

const TOKYO = { lat: 35.681236, lng: 139.767125 }
const SHINJUKU = { lat: 35.690921, lng: 139.700258 }

describe('haversineKm', () => {
  it('is 0 for the same point', () => {
    expect(haversineKm(TOKYO, TOKYO)).toBe(0)
  })
  it('Tokyo Station → Shinjuku Station ≈ 6.1 km', () => {
    expect(haversineKm(TOKYO, SHINJUKU)).toBeCloseTo(6.13, 1)
  })
  it('1 degree of latitude ≈ 111.2 km', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.19, 1)
  })
  it('is symmetric', () => {
    expect(haversineKm(TOKYO, SHINJUKU)).toBeCloseTo(haversineKm(SHINJUKU, TOKYO), 10)
  })
})

describe('bearingDeg', () => {
  it('cardinal directions', () => {
    const o = { lat: 35, lng: 139 }
    expect(bearingDeg(o, { lat: 36, lng: 139 })).toBeCloseTo(0, 5)
    expect(bearingDeg(o, { lat: 34, lng: 139 })).toBeCloseTo(180, 5)
    expect(bearingDeg(o, { lat: 35, lng: 140 })).toBeCloseTo(90, 0)
    expect(bearingDeg(o, { lat: 35, lng: 138 })).toBeCloseTo(270, 0)
  })
  it('Shinjuku is west-ish of Tokyo Station', () => {
    const b = bearingDeg(TOKYO, SHINJUKU)
    expect(b).toBeGreaterThan(270)
    expect(b).toBeLessThan(290)
  })
})

describe('destinationPoint', () => {
  it('round-trips with haversine and bearing', () => {
    for (const bearing of [0, 45, 133, 270, 359]) {
      const p = destinationPoint(TOKYO, bearing, 5)
      expect(haversineKm(TOKYO, p)).toBeCloseTo(5, 6)
      const diff = Math.abs(((bearingDeg(TOKYO, p) - bearing + 540) % 360) - 180)
      expect(diff).toBeLessThan(1e-3)
    }
  })
  it('wraps longitude across the antimeridian', () => {
    const p = destinationPoint({ lat: 0, lng: 179.99 }, 90, 10)
    expect(p.lng).toBeLessThan(-179)
  })
})

describe('interpolateLine / samplePolyline', () => {
  it('includes both endpoints and is evenly spaced', () => {
    const pts = interpolateLine(TOKYO, SHINJUKU, 5)
    expect(pts).toHaveLength(5)
    expect(pts[0]).toEqual(TOKYO)
    expect(pts[4].lat).toBeCloseTo(SHINJUKU.lat, 10)
    const d1 = haversineKm(pts[0], pts[1])
    const d2 = haversineKm(pts[3], pts[4])
    expect(d1).toBeCloseTo(d2, 2)
  })
  it('throws for count < 2', () => {
    expect(() => interpolateLine(TOKYO, SHINJUKU, 1)).toThrow(RangeError)
  })
  it('samplePolyline spaces points by distance along an L-shaped path', () => {
    const a = { lat: 35, lng: 139 }
    const b = destinationPoint(a, 0, 3)
    const c = destinationPoint(b, 90, 1)
    const path = [a, b, c]
    const total = polylineLengthKm(path)
    expect(total).toBeCloseTo(4, 3)
    const s = samplePolyline(path, 5) // every 1 km
    expect(s).toHaveLength(5)
    expect(haversineKm(a, s[3])).toBeCloseTo(3, 2)
    expect(s[4].lat).toBeCloseTo(c.lat, 8)
    expect(s[4].lng).toBeCloseTo(c.lng, 8)
  })
  it('samplePolyline handles degenerate input', () => {
    expect(samplePolyline([], 3)).toEqual([])
    expect(samplePolyline([TOKYO], 3)).toHaveLength(3)
  })
})

describe('compass helpers', () => {
  it('bearingToCompassJa', () => {
    expect(bearingToCompassJa(0)).toBe('北')
    expect(bearingToCompassJa(350)).toBe('北')
    expect(bearingToCompassJa(90)).toBe('東')
    expect(bearingToCompassJa(225)).toBe('南西')
  })
  it('bearingSector centers sector 0 on north', () => {
    expect(bearingSector(0)).toBe(0)
    expect(bearingSector(359)).toBe(0)
    expect(bearingSector(22)).toBe(0)
    expect(bearingSector(23)).toBe(1)
    expect(bearingSector(180)).toBe(4)
    expect(bearingSector(90, 4)).toBe(1)
  })
})
