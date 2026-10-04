import { beforeEach, describe, expect, it } from 'vitest'
import { jsonResponse, mockFetch } from '../test/fetchMock'
import {
  buildElevationUrl,
  classifyElevation,
  clearElevationCache,
  ELEVATION_THRESHOLDS,
  fetchElevations,
  fetchElevationSummaries,
  OPEN_METEO_MAX_POINTS,
  summarizeElevation,
} from './elevation'
import { destinationPoint } from './geo'

beforeEach(() => clearElevationCache())

describe('summarizeElevation', () => {
  it('flat profile', () => {
    const s = summarizeElevation([10, 10, 10, 10], 3)
    expect(s).toMatchObject({ gainOneWayM: 0, lossOneWayM: 0, gainRoundTripM: 0, maxGradePct: 0, label: 'flat' })
  })
  it('computes one-way / round-trip gain and max grade', () => {
    // 1 km, 4 segments of 250 m: +10, +20, -5, +5
    const s = summarizeElevation([0, 10, 30, 25, 30], 1)
    expect(s.gainOneWayM).toBe(35)
    expect(s.lossOneWayM).toBe(5)
    expect(s.gainRoundTripM).toBe(40)
    expect(s.maxGradePct).toBe(8) // 20 m / 250 m
    expect(s.gainPerKm).toBe(20) // 40 m / 2 km
    expect(s.label).toBe('hilly')
    expect(s.profile).toEqual([0, 10, 30, 25, 30])
  })
  it('a descent to the destination still counts as climbing on the way back', () => {
    const s = summarizeElevation([100, 50], 5)
    expect(s.gainOneWayM).toBe(0)
    expect(s.gainRoundTripM).toBe(50)
    expect(s.gainPerKm).toBe(5) // 50 m / 10 km
    expect(s.label).toBe('flat')
  })
  it('noise threshold suppresses DEM jitter', () => {
    const jitter = [10, 11, 10, 11, 10, 11, 10]
    expect(summarizeElevation(jitter, 3).gainOneWayM).toBe(3)
    expect(summarizeElevation(jitter, 3, { noiseThresholdM: 2 }).gainOneWayM).toBe(0)
  })
  it('ignores non-finite values and handles zero distance', () => {
    const s = summarizeElevation([1, Number.NaN, 5], 0)
    expect(s.profile).toEqual([1, 5])
    expect(s.gainPerKm).toBe(0)
    expect(s.maxGradePct).toBe(0)
  })
})

describe('classifyElevation', () => {
  it('uses thresholds (flat < 8 <= rolling < 20 <= hilly)', () => {
    expect(ELEVATION_THRESHOLDS).toEqual({ flatMaxGainPerKm: 8, rollingMaxGainPerKm: 20 })
    expect(classifyElevation(0)).toBe('flat')
    expect(classifyElevation(7.9)).toBe('flat')
    expect(classifyElevation(8)).toBe('rolling')
    expect(classifyElevation(19.9)).toBe('rolling')
    expect(classifyElevation(20)).toBe('hilly')
  })
  it('accepts custom thresholds', () => {
    expect(classifyElevation(10, { flatMaxGainPerKm: 12, rollingMaxGainPerKm: 30 })).toBe('flat')
  })
})

describe('Open-Meteo client', () => {
  const origin = { lat: 35.68, lng: 139.76 }
  const manyPoints = (n: number) => Array.from({ length: n }, (_, i) => destinationPoint(origin, (i * 7) % 360, 0.1 + i * 0.05))

  it('builds comma-separated URL', () => {
    expect(buildElevationUrl([{ lat: 1, lng: 2 }, { lat: 3.123456789, lng: 4 }])).toBe(
      'https://api.open-meteo.com/v1/elevation?latitude=1.00000,3.12346&longitude=2.00000,4.00000',
    )
  })

  it('batches into chunks of at most 100 points and keeps order', async () => {
    const f = mockFetch((url) => {
      const n = new URL(url).searchParams.get('latitude')!.split(',').length
      return jsonResponse({ elevation: Array.from({ length: n }, (_, i) => i) })
    })
    const pts = manyPoints(230)
    const out = await fetchElevations(pts)
    expect(f).toHaveBeenCalledTimes(3)
    const sizes = f.mock.calls.map(([u]) => new URL(String(u)).searchParams.get('latitude')!.split(',').length)
    expect(sizes.every((s) => s <= OPEN_METEO_MAX_POINTS)).toBe(true)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(230)
    expect(out).toHaveLength(230)
    expect(out![0]).toBe(0)
    expect(out![100]).toBe(0)
    expect(out![229]).toBe(29)
  })

  it('caches and dedupes points', async () => {
    const f = mockFetch((url) => {
      const n = new URL(url).searchParams.get('latitude')!.split(',').length
      return jsonResponse({ elevation: Array(n).fill(42) })
    })
    const p = { lat: 35.1, lng: 139.1 }
    expect(await fetchElevations([p, p, p])).toEqual([42, 42, 42])
    expect(new URL(String(f.mock.calls[0][0])).searchParams.get('latitude')).toBe('35.10000')
    expect(await fetchElevations([p])).toEqual([42])
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('returns null on HTTP failure or malformed response', async () => {
    mockFetch(() => jsonResponse({ error: true }, 429))
    expect(await fetchElevations(manyPoints(3))).toBeNull()
    clearElevationCache()
    mockFetch(() => jsonResponse({ elevation: [1] }))
    expect(await fetchElevations(manyPoints(3))).toBeNull()
  })

  it('fetchElevationSummaries batches many candidates into few requests', async () => {
    const f = mockFetch((url) => {
      const lats = new URL(url).searchParams.get('latitude')!.split(',').map(Number)
      // elevation rises 100 m per 0.01° north
      return jsonResponse({ elevation: lats.map((lat) => (lat - origin.lat) * 10_000) })
    })
    const dests = Array.from({ length: 25 }, (_, i) => ({ id: `p${i}`, ...destinationPoint(origin, i * 14.4, 3) }))
    const res = await fetchElevationSummaries(origin, dests, { samplesPerRoute: 10 })
    // 25 × 10 = 250 points, but the origin repeats → ≤ 3 requests
    expect(f.mock.calls.length).toBeLessThanOrEqual(3)
    expect(res.size).toBe(25)
    const north = res.get('p0')!
    expect(north.gainOneWayM).toBeGreaterThan(200)
    expect(north.lossOneWayM).toBe(0)
    expect(north.label).toBe('hilly')
    const south = res.get('p12')! // ≈ 173°
    expect(south.gainOneWayM).toBe(0)
    expect(south.lossOneWayM).toBeGreaterThan(200)
  })

  it('fetchElevationSummaries maps all to null on failure', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch')
    })
    const res = await fetchElevationSummaries(origin, [{ id: 'a', lat: 35.7, lng: 139.8 }])
    expect(res.get('a')).toBeNull()
  })
})
