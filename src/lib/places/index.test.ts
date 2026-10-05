import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError, TimeoutError } from '../http'
import type { Place, PlaceProvider, PlaceSource } from '../types'
import { createLocalStorageCache } from './cache'
import { clearPlacesCache, createDefaultProviders, createDemoProviders, fallbackReason, searchPlaces } from './index'
import { OverpassRemarkError } from './overpass'

const C = { lat: 35.6812, lng: 139.7671 }
const place = (id: string): Place => ({ id, name: id, lat: 35.7, lng: 139.8, category: 'park', distanceKm: 3, bearing: 0, source: 'mock' })

function provider(name: PlaceSource, impl: () => Promise<Place[]>): PlaceProvider & { search: ReturnType<typeof vi.fn> } {
  return { name, search: vi.fn(impl) }
}
const cache = () => createLocalStorageCache(localStorage)

beforeEach(() => clearPlacesCache())

describe('searchPlaces', () => {
  it('uses the first successful provider, kind ok, recomputes distance from the real center', async () => {
    const o = provider('overpass', async () => [place('o1')])
    const m = provider('mock', async () => [place('m1')])
    const r = await searchPlaces(C, { providers: [o, m], cache: cache() })
    expect(r).toMatchObject({ kind: 'ok', source: 'overpass', isDemo: false })
    expect(r.places[0].source).toBe('overpass')
    expect(r.places[0].distanceKm).toBeCloseTo(3.63, 1) // relocated: (35.7,139.8) measured from C, not the provider's 3 km
    expect(m.search).not.toHaveBeenCalled()
  })

  it('queries once with a ~1km-snapped center and a radius covering every preset × time (R6/A2)', async () => {
    const o = provider('overpass', async () => [])
    await searchPlaces({ lat: 35.68123, lng: 139.76789 }, { providers: [o], cache: cache() })
    const [center, minKm, maxKm] = o.search.mock.calls[0]
    expect(center).toEqual({ lat: 35.68, lng: 139.77 })
    expect(minKm).toBeLessThan(1)
    expect(maxKm).toBeGreaterThan(11.5) // 20km/h × 90min reach + grid margin
  })

  it('a real provider succeeding with 0 results is kind "empty" and does NOT fall back to mock', async () => {
    const o = provider('overpass', async () => [])
    const m = provider('mock', async () => [place('m1')])
    const r = await searchPlaces(C, { providers: [o, m], cache: cache() })
    expect(r).toMatchObject({ kind: 'empty', source: 'overpass', isDemo: false, places: [] })
    expect(m.search).not.toHaveBeenCalled()
  })

  it('falls back to mock only on failure (kind demo) and records errors', async () => {
    const o = provider('overpass', async () => {
      throw new HttpError(429, 'x')
    })
    const m = provider('mock', async () => [place('m1')])
    const r = await searchPlaces(C, { providers: [o, m], cache: cache() })
    expect(r).toMatchObject({ kind: 'demo', source: 'mock', isDemo: true })
    expect(r.errors.map((e) => e.provider)).toEqual(['overpass'])
    expect(fallbackReason(r.errors)).toBe('busy')
  })

  it('throws AggregateError when all fail', async () => {
    const o = provider('overpass', async () => {
      throw new Error('x')
    })
    await expect(searchPlaces(C, { providers: [o], cache: cache() })).rejects.toBeInstanceOf(AggregateError)
  })

  it('stops falling back when the caller aborts', async () => {
    const ac = new AbortController()
    const o = provider('overpass', async () => {
      ac.abort()
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    })
    const m = provider('mock', async () => [place('m1')])
    await expect(searchPlaces(C, { providers: [o, m], signal: ac.signal, cache: cache() })).rejects.toMatchObject({ name: 'AbortError' })
    expect(m.search).not.toHaveBeenCalled()
  })

  it('shares an in-flight request for the same key', async () => {
    let resolve!: (v: Place[]) => void
    const o = provider('overpass', () => new Promise<Place[]>((r) => (resolve = r)))
    const c = cache()
    const a = searchPlaces(C, { providers: [o], cache: c })
    const b = searchPlaces({ lat: C.lat + 0.001, lng: C.lng }, { providers: [o], cache: c })
    await Promise.resolve()
    await Promise.resolve()
    resolve([place('o1')])
    const [ra, rb] = await Promise.all([a, b])
    expect(o.search).toHaveBeenCalledTimes(1)
    expect(ra.places).toHaveLength(1)
    expect(rb.places).toHaveLength(1)
  })

  it('persists results with a 7-day TTL and does not cache demo results', async () => {
    const o = provider('overpass', async () => [place('o1')])
    const c = cache()
    const t0 = Date.parse('2026-10-01T00:00:00Z')
    await searchPlaces(C, { providers: [o], cache: c, now: t0 })
    clearPlacesCache() // drop memory cache → must come from the persistent cache
    const hit = await searchPlaces(C, { providers: [o], cache: c, now: t0 + 6 * 86400_000 })
    expect(hit.fromCache).toBe(true)
    expect(o.search).toHaveBeenCalledTimes(1)
    clearPlacesCache()
    await searchPlaces(C, { providers: [o], cache: c, now: t0 + 8 * 86400_000 })
    expect(o.search).toHaveBeenCalledTimes(2)

    const m = provider('mock', async () => [place('m1')])
    await searchPlaces(C, { providers: [m], cache: c })
    await searchPlaces(C, { providers: [m], cache: c })
    expect(m.search).toHaveBeenCalledTimes(2)
  })

  it('default providers are Overpass → Mock (no paid APIs); demo is Mock only', () => {
    expect(createDefaultProviders().map((p) => p.name)).toEqual(['overpass', 'mock'])
    expect(createDemoProviders().map((p) => p.name)).toEqual(['mock'])
  })
})

describe('fallbackReason', () => {
  it.each([
    [[{ error: new HttpError(429, 'u') }], 'busy'],
    [[{ error: new HttpError(504, 'u') }], 'busy'],
    [[{ error: new TimeoutError(1) }], 'busy'],
    [[{ error: new OverpassRemarkError('runtime error: timeout') }], 'busy'],
    [[{ error: new TypeError('Failed to fetch') }], 'network'],
    [[{ error: new Error('?') }], 'unknown'],
    [[], null],
  ] as const)('%#', (errors, expected) => {
    expect(fallbackReason(errors as unknown as { error: unknown }[])).toBe(expected)
  })
})
