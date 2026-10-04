import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Place, PlaceProvider, PlaceSource } from '../types'
import { clearPlacesCache, createDefaultProviders, searchPlaces } from './index'

const C = { lat: 35.68, lng: 139.76 }
const place = (id: string): Place => ({ id, name: id, lat: 0, lng: 0, category: 'park', distanceKm: 3, bearing: 0, source: 'mock' })

function provider(name: PlaceSource, impl: () => Promise<Place[]>): PlaceProvider & { search: ReturnType<typeof vi.fn> } {
  return { name, search: vi.fn(impl) }
}

beforeEach(() => clearPlacesCache())

describe('searchPlaces fallback', () => {
  it('uses the first successful provider and tags source', async () => {
    const g = provider('google', async () => [place('g1')])
    const o = provider('overpass', async () => [place('o1')])
    const r = await searchPlaces(C, 2, 4, { providers: [g, o] })
    expect(r.source).toBe('google')
    expect(r.isDemo).toBe(false)
    expect(r.places[0].source).toBe('google')
    expect(o.search).not.toHaveBeenCalled()
  })

  it('Google → Overpass → Mock on failures, recording errors', async () => {
    const g = provider('google', async () => {
      throw new Error('quota')
    })
    const o = provider('overpass', async () => {
      throw new Error('504')
    })
    const m = provider('mock', async () => [place('m1')])
    const r = await searchPlaces(C, 2, 4, { providers: [g, o, m] })
    expect(r.source).toBe('mock')
    expect(r.isDemo).toBe(true)
    expect(r.errors.map((e) => e.provider)).toEqual(['google', 'overpass'])
  })

  it('treats too few results as a fallthrough', async () => {
    const o = provider('overpass', async () => [])
    const m = provider('mock', async () => [place('m1')])
    expect((await searchPlaces(C, 2, 4, { providers: [o, m] })).source).toBe('mock')
  })

  it('returns the best partial result if nobody reaches minResults', async () => {
    const o = provider('overpass', async () => [place('o1'), place('o2')])
    const m = provider('mock', async () => [place('m1')])
    const r = await searchPlaces(C, 2, 4, { providers: [o, m], minResults: 10 })
    expect(r.source).toBe('overpass')
    expect(r.places).toHaveLength(2)
  })

  it('throws AggregateError when all fail', async () => {
    const o = provider('overpass', async () => {
      throw new Error('x')
    })
    await expect(searchPlaces(C, 2, 4, { providers: [o] })).rejects.toBeInstanceOf(AggregateError)
  })

  it('stops falling back when the caller aborts', async () => {
    const ac = new AbortController()
    const o = provider('overpass', async () => {
      ac.abort()
      const e = new Error('aborted')
      e.name = 'AbortError'
      throw e
    })
    const m = provider('mock', async () => [place('m1')])
    await expect(searchPlaces(C, 2, 4, { providers: [o, m], signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(m.search).not.toHaveBeenCalled()
  })

  it('caches results per center / band', async () => {
    const o = provider('overpass', async () => [place('o1')])
    await searchPlaces(C, 2, 4, { providers: [o] })
    await searchPlaces(C, 2, 4, { providers: [o] })
    expect(o.search).toHaveBeenCalledTimes(1)
    await searchPlaces(C, 3, 5, { providers: [o] })
    expect(o.search).toHaveBeenCalledTimes(2)
  })

  it('default providers include Google only with a key', () => {
    expect(createDefaultProviders(undefined).map((p) => p.name)).toEqual(['overpass', 'mock'])
    expect(createDefaultProviders('KEY').map((p) => p.name)).toEqual(['google', 'overpass', 'mock'])
  })
})
