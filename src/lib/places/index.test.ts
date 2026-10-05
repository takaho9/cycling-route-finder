import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpError, TimeoutError } from '../http'
import type { Place, PlaceProvider, PlaceSource } from '../types'
import { createLocalStorageCache } from './cache'
import { clearPlacesCache, createDefaultProviders, createDemoProviders, fallbackReason, inflightCount, searchPlaces } from './index'
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

  it('queries once with a ~1km-snapped center and a radius of the CURRENT speed × 90 min (R6/A2/C1)', async () => {
    const o = provider('overpass', async () => [])
    await searchPlaces({ lat: 35.68123, lng: 139.76789 }, { providers: [o], cache: cache(), speedKmh: 16 })
    const [center, minKm, maxKm] = o.search.mock.calls[0]
    expect(center).toEqual({ lat: 35.68, lng: 139.77 })
    expect(minKm).toBeLessThan(1)
    // 16km/h × 90分 ÷ 2 ÷ 1.3 = 9.23km + グリッド余白 0.8km
    expect(maxKm).toBeCloseTo(10.03, 1)
  })

  it('a different speed is a different cache key and refetches with its own radius (C1)', async () => {
    const o = provider('overpass', async () => [place('o1')])
    const c = cache()
    await searchPlaces(C, { providers: [o], cache: c, speedKmh: 12 })
    await searchPlaces(C, { providers: [o], cache: c, speedKmh: 12 })
    expect(o.search).toHaveBeenCalledTimes(1)
    await searchPlaces(C, { providers: [o], cache: c, speedKmh: 20 })
    expect(o.search).toHaveBeenCalledTimes(2)
    const radii = o.search.mock.calls.map((c) => c[2] as number)
    expect(radii[0]).toBeCloseTo(12 * 1.5 / 2 / 1.3 + 0.8, 2)
    expect(radii[1]).toBeCloseTo(20 * 1.5 / 2 / 1.3 + 0.8, 2)
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

  it('C2: when the first caller aborts, a caller that joined the shared run still succeeds', async () => {
    let resolve!: (v: Place[]) => void
    let providerSignal: AbortSignal | undefined
    const o = provider('overpass', (...args: unknown[]) => {
      providerSignal = args[3] as AbortSignal
      return new Promise<Place[]>((r) => (resolve = r))
    })
    const c = cache()
    const first = new AbortController()
    const a = searchPlaces(C, { providers: [o], cache: c, signal: first.signal })
    const b = searchPlaces(C, { providers: [o], cache: c, signal: new AbortController().signal })
    await Promise.resolve()
    await Promise.resolve()
    first.abort()
    await expect(a).rejects.toMatchObject({ name: 'AbortError' })
    expect(providerSignal?.aborted).toBe(false) // まだ b が待っているので run は止めない
    resolve([place('o1')])
    const rb = await b
    expect(rb.kind).toBe('ok')
    expect(rb.places.map((p) => p.id)).toEqual(['o1'])
    expect(o.search).toHaveBeenCalledTimes(1)
  })

  it('C2: the shared run is aborted only when every subscriber has left; the next call starts fresh', async () => {
    const signals: AbortSignal[] = []
    const o = provider('overpass', (...args: unknown[]) => {
      const s = args[3] as AbortSignal
      signals.push(s)
      return new Promise<Place[]>((_r, rej) => s.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    })
    const c = cache()
    const x = new AbortController()
    const y = new AbortController()
    const a = searchPlaces(C, { providers: [o], cache: c, signal: x.signal })
    const b = searchPlaces(C, { providers: [o], cache: c, signal: y.signal })
    await Promise.resolve()
    await Promise.resolve()
    x.abort()
    expect(signals[0].aborted).toBe(false)
    y.abort()
    expect(signals[0].aborted).toBe(true)
    await expect(a).rejects.toMatchObject({ name: 'AbortError' })
    await expect(b).rejects.toMatchObject({ name: 'AbortError' })
    expect(inflightCount()).toBe(0)

    const ok = provider('overpass', async () => [place('o2')])
    const r = await searchPlaces(C, { providers: [ok], cache: c })
    expect(r.places.map((p) => p.id)).toEqual(['o2'])
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
    [[{ error: new Error('?') }], 'unknown'],
    [[], null],
  ] as const)('%#', (errors, expected) => {
    expect(fallbackReason(errors as unknown as { error: unknown }[])).toBe(expected)
  })
  it('TypeError while navigator.onLine → busy (CORS-less 429 etc.); offline → network (C12)', () => {
    const errors = [{ error: new TypeError('Failed to fetch') }]
    expect(fallbackReason(errors, true)).toBe('busy')
    expect(fallbackReason(errors, false)).toBe('network')
  })
})
