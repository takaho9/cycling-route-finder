import { beforeEach, describe, expect, it } from 'vitest'
import { hangingFetch, jsonResponse, mockFetch } from '../test/fetchMock'
import {
  buildElevationUrl,
  classifyElevation,
  clearElevationCache,
  DEFAULT_NOISE_THRESHOLD_M,
  ELEVATION_RULES,
  fetchElevations,
  fetchElevationSummaries,
  looksLikeWaterCrossing,
  OPEN_METEO_MAX_POINTS,
  routeSampleCount,
  smoothedMaxGradePct,
  summarizeElevation,
} from './elevation'
import { destinationPoint } from './geo'

beforeEach(() => clearElevationCache())

describe('summarizeElevation', () => {
  it('flat profile', () => {
    const s = summarizeElevation([10, 10, 10, 10], 3)
    expect(s).toMatchObject({ gainOneWayM: 0, lossOneWayM: 0, gainRoundTripM: 0, maxGradePct: 0, climbM: 0, label: 'flat' })
    expect(s.profileKm).toEqual([0, 1, 2, 3])
  })
  it('computes one-way / round-trip gain, G = max(up, down), R = G / one-way km', () => {
    // 2 km, 4 segments of 500 m: +10, +20, -5, +5
    const s = summarizeElevation([0, 10, 30, 25, 30], 2, { noiseThresholdM: 0 })
    expect(s.gainOneWayM).toBe(35)
    expect(s.lossOneWayM).toBe(5)
    expect(s.gainRoundTripM).toBe(40)
    expect(s.climbM).toBe(35)
    expect(s.climbPerKm).toBe(17.5)
    expect(s.maxGradePct).toBe(4) // 20 m / 500 m
    expect(s.label).toBe('hilly') // R >= 15
    expect(s.estimated).toBe(true)
  })
  it('a descent to the destination counts as the climb on the way back (harder direction)', () => {
    const s = summarizeElevation([100, 50], 5)
    expect(s.gainOneWayM).toBe(0)
    expect(s.climbM).toBe(50)
    expect(s.climbPerKm).toBe(10)
    expect(s.label).toBe('rolling') // G >= 40
  })
  it('default noise threshold is 5 m (DEM jitter does not accumulate)', () => {
    expect(DEFAULT_NOISE_THRESHOLD_M).toBe(5)
    const jitter = [10, 14, 10, 14, 10, 14, 10]
    expect(summarizeElevation(jitter, 3).gainOneWayM).toBe(0)
    expect(summarizeElevation(jitter, 3, { noiseThresholdM: 0 }).gainOneWayM).toBe(12)
  })
  it('drops missing samples but keeps their true distance positions', () => {
    const s = summarizeElevation([0, null, 20, Number.NaN, 20], 2)
    expect(s.profile).toEqual([0, 20, 20])
    expect(s.profileKm).toEqual([0, 1, 2])
    expect(s.maxGradePct).toBe(2) // 20 m over 1 km (window 300 m → next valid point)
    expect(s.distanceKm).toBe(2)
  })
  it('handles zero distance', () => {
    const s = summarizeElevation([1, 5], 0)
    expect(s.climbPerKm).toBe(0)
    expect(s.maxGradePct).toBe(0)
  })
  it('detects runs of <= 0 m samples (water crossing)', () => {
    expect(summarizeElevation([5, 0, -1, 0, 4], 4).seaRun).toBe(3)
    expect(looksLikeWaterCrossing(summarizeElevation([5, 0, 4, 0, 4], 4))).toBe(false)
    expect(looksLikeWaterCrossing(summarizeElevation([5, 0, 0, 4], 4))).toBe(true)
    expect(looksLikeWaterCrossing(null)).toBe(false)
  })
})

describe('smoothedMaxGradePct (>= 300 m window)', () => {
  const km = (n: number, stepKm: number) => Array.from({ length: n }, (_, i) => i * stepKm)
  it('a one-sample 6 m spike at 100 m spacing is evaluated over 300 m, not 100 m', () => {
    const p = Array(21).fill(0)
    p[10] = 6
    expect(smoothedMaxGradePct(p, km(21, 0.1), 300)).toBeCloseTo(2, 5) // 6 m / 300 m (not 6 %)
  })
  it('uses the raw spacing when samples are already >= 300 m apart', () => {
    expect(smoothedMaxGradePct([0, 30, 30], km(3, 0.3), 300)).toBeCloseTo(10, 5)
  })
  it('averages the whole route when it is shorter than the window', () => {
    expect(smoothedMaxGradePct([0, 4, 6], km(3, 0.04), 300)).toBeCloseTo(7.5, 5)
  })
  it('a sustained steep section makes it hilly only for route-based (non-estimated) summaries', () => {
    // 3 km, 100 m spacing, 400 m long section at 10 % (40 m) then flat; G=40 → R=13.3
    const p = Array.from({ length: 31 }, (_, i) => (i <= 5 ? 0 : i <= 9 ? (i - 5) * 10 : 40))
    const route = summarizeElevation(p, 3, { estimated: false })
    expect(route.maxGradePct).toBe(10)
    expect(route.label).toBe('hilly')
    expect(route.estimated).toBe(false)
    const listEstimate = summarizeElevation(p, 3)
    expect(listEstimate.maxGradePct).toBe(10)
    expect(listEstimate.label).toBe('rolling') // grade is ignored for list estimates (A8)
  })
})

describe('classifyElevation boundaries', () => {
  const c = (climbM: number, climbPerKm: number, maxGradePct = 0) => classifyElevation({ climbM, climbPerKm, maxGradePct })
  it('constants', () => {
    expect(ELEVATION_RULES).toEqual({
      hillyMinClimbPerKm: 15,
      hillyMinClimbM: 150,
      hillyMinGradePct: 8,
      rollingMinClimbPerKm: 6,
      rollingMinClimbM: 40,
      minGradeSegmentM: 300,
    })
  })
  it.each([
    [0, 0, 0, 'flat'],
    [39.9, 5.99, 7.99, 'flat'],
    [40, 1, 0, 'rolling'],
    [10, 6, 0, 'rolling'],
    [149.9, 14.99, 7.99, 'rolling'],
    [150, 1, 0, 'hilly'],
    [20, 15, 0, 'hilly'],
    [5, 1, 8, 'hilly'],
  ] as const)('G=%s R=%s grade=%s → %s', (g, r, gr, label) => {
    expect(c(g, r, gr)).toBe(label)
  })
  it('accepts custom rules', () => {
    expect(classifyElevation({ climbM: 50, climbPerKm: 7, maxGradePct: 0 }, { ...ELEVATION_RULES, rollingMinClimbM: 60, rollingMinClimbPerKm: 8 })).toBe('flat')
  })
})

describe('Open-Meteo client', () => {
  const origin = { lat: 35.68, lng: 139.76 }
  const manyPoints = (n: number) => Array.from({ length: n }, (_, i) => destinationPoint(origin, (i * 7) % 360, 0.1 + i * 0.05))
  const countOf = (url: unknown) => new URL(String(url)).searchParams.get('latitude')!.split(',').length

  it('builds comma-separated URL with coordinates rounded to 4 decimals', () => {
    expect(buildElevationUrl([{ lat: 1, lng: 2 }, { lat: 3.123456789, lng: 4 }])).toBe(
      'https://api.open-meteo.com/v1/elevation?latitude=1.0000,3.1235&longitude=2.0000,4.0000',
    )
  })

  it('batches into chunks of at most 100 points and keeps order', async () => {
    const f = mockFetch((url) => jsonResponse({ elevation: Array.from({ length: countOf(url) }, (_, i) => i) }))
    const out = await fetchElevations(manyPoints(230))
    expect(f).toHaveBeenCalledTimes(3)
    const sizes = f.mock.calls.map(([u]) => countOf(u))
    expect(sizes.every((s) => s <= OPEN_METEO_MAX_POINTS)).toBe(true)
    expect(out).toHaveLength(230)
    expect(out![229]).toBe(29)
  })

  it('caches and dedupes points', async () => {
    const f = mockFetch((url) => jsonResponse({ elevation: Array(countOf(url)).fill(42) }))
    const p = { lat: 35.1, lng: 139.1 }
    expect(await fetchElevations([p, p, p])).toEqual([42, 42, 42])
    expect(await fetchElevations([p])).toEqual([42])
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('partial success: a failed batch yields nulls only for its points', async () => {
    let call = 0
    mockFetch((url) => (call++ === 0 ? jsonResponse({ elevation: Array(countOf(url)).fill(7) }) : jsonResponse({}, 429)))
    const out = await fetchElevations(manyPoints(150), { concurrency: 1 })
    expect(out!.slice(0, 100).every((v) => v === 7)).toBe(true)
    expect(out!.slice(100).every((v) => v === null)).toBe(true)
  })

  it('returns null when everything fails', async () => {
    mockFetch(() => jsonResponse({ error: true }, 429))
    expect(await fetchElevations(manyPoints(3))).toBeNull()
  })

  it('throws AbortError when the caller aborts', async () => {
    mockFetch(hangingFetch)
    const ac = new AbortController()
    const p = fetchElevations(manyPoints(3), { signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('fetchElevationSummaries batches many candidates into few requests', async () => {
    const f = mockFetch((url) => {
      const lats = new URL(url).searchParams.get('latitude')!.split(',').map(Number)
      return jsonResponse({ elevation: lats.map((lat) => (lat - origin.lat) * 10_000) })
    })
    const dests = Array.from({ length: 25 }, (_, i) => ({ id: `p${i}`, ...destinationPoint(origin, i * 14.4, 3) }))
    const res = await fetchElevationSummaries(origin, dests, { samplesPerRoute: 10 })
    expect(f.mock.calls.length).toBeLessThanOrEqual(3)
    expect(res.size).toBe(25)
    expect(res.get('p0')!.label).toBe('hilly')
    expect(res.get('p12')!.lossOneWayM).toBeGreaterThan(200)
  })

  it('fetchElevationSummaries maps all to null on failure', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    const res = await fetchElevationSummaries(origin, [{ id: 'a', lat: 35.7, lng: 139.8 }])
    expect(res.get('a')).toBeNull()
  })

  it('routeSampleCount ≈ every 100 m, clamped to 10..100', () => {
    expect(routeSampleCount(0.3)).toBe(10)
    expect(routeSampleCount(5)).toBe(51)
    expect(routeSampleCount(30)).toBe(100)
  })
})
