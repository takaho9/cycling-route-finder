import { beforeEach, describe, expect, it } from 'vitest'
import { hangingFetch, jsonResponse, mockFetch } from '../test/fetchMock'
import { buildOsrmUrl, clearRouteCache, fetchRoute } from './routing'

const A = { lat: 35.681236, lng: 139.767125 }
const B = { lat: 35.690921, lng: 139.700258 }

beforeEach(() => clearRouteCache())

describe('routing', () => {
  it('builds OSRM URL with lng,lat order; defaults to the bike server', () => {
    expect(buildOsrmUrl(A, B)).toBe(
      'https://routing.openstreetmap.de/routed-bike/route/v1/bike/139.767125,35.681236;139.700258,35.690921?overview=simplified&geometries=geojson',
    )
  })

  it('falls back routed-bike → project-osrm → straight', async () => {
    const f = mockFetch((url) =>
      url.startsWith('https://routing.openstreetmap.de')
        ? jsonResponse({}, 502)
        : jsonResponse({ code: 'Ok', routes: [{ distance: 8000, duration: 1, geometry: { coordinates: [[139.767125, 35.681236], [139.700258, 35.690921]] } }] }),
    )
    const r = await fetchRoute(A, B)
    expect(r).toMatchObject({ source: 'osrm', distanceKm: 8 })
    expect(f.mock.calls.map(([u]) => new URL(String(u)).host)).toEqual(['routing.openstreetmap.de', 'router.project-osrm.org'])
  })

  it('parses OSRM geometry and distance', async () => {
    const f = mockFetch(() =>
      jsonResponse({
        code: 'Ok',
        routes: [{ distance: 7400, duration: 1500, geometry: { coordinates: [[139.767125, 35.681236], [139.73, 35.69], [139.700258, 35.690921]] } }],
      }),
    )
    const r = await fetchRoute(A, B)
    expect(r.source).toBe('osrm')
    expect(r.distanceKm).toBeCloseTo(7.4)
    expect(r.path[1]).toEqual({ lat: 35.69, lng: 139.73 })
    await fetchRoute(A, B)
    expect(f).toHaveBeenCalledTimes(1) // cached
  })

  it('falls back to straight line on error', async () => {
    const f = mockFetch(() => jsonResponse({ code: 'NoRoute' }))
    const r = await fetchRoute(A, B)
    expect(f).toHaveBeenCalledTimes(2)
    expect(r.source).toBe('straight')
    expect(r.distanceKm).toBeCloseTo(6.13, 1)
    expect(r.path).toHaveLength(2)
  })

  it('falls back on network error', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    expect((await fetchRoute(A, B)).source).toBe('straight')
  })

  it('rethrows when caller aborts', async () => {
    mockFetch(hangingFetch)
    const ac = new AbortController()
    const p = fetchRoute(A, B, { signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})
