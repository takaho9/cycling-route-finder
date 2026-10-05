import { beforeEach, describe, expect, it } from 'vitest'
import { jsonResponse, mockFetch } from '../test/fetchMock'
import { clearElevationCache } from './elevation'
import { clearRouteCache } from './routing'
import { demoServices, realServices } from './services'
import type { Place } from './types'

const origin = { lat: 35.6812, lng: 139.7671 }
const place: Place = { id: 'osm:node/1', name: '展望台', lat: 35.7012, lng: 139.7456, category: 'viewpoint', distanceKm: 2.9, bearing: 315, source: 'overpass' }

/** Open-Meteo: 座標数ぶんの標高を返す（なだらかな上り） */
function elevationResponse(url: string) {
  const n = new URL(url).searchParams.get('latitude')!.split(',').length
  return jsonResponse({ elevation: Array.from({ length: n }, (_, i) => 10 + i * 2) })
}

beforeEach(() => {
  clearRouteCache()
  clearElevationCache()
})

describe('routeDetail (C3)', () => {
  it('OSRM route → elevation is route-based (estimated=false)', async () => {
    mockFetch((url) => {
      if (url.includes('routing.openstreetmap.de')) {
        return jsonResponse({
          code: 'Ok',
          routes: [{ distance: 3800, duration: 900, geometry: { coordinates: [[origin.lng, origin.lat], [139.76, 35.69], [place.lng, place.lat]] } }],
        })
      }
      return elevationResponse(url)
    })
    const r = await realServices.routeDetail(origin, place)
    expect(r.route.source).toBe('osrm')
    expect(r.route.distanceKm).toBeCloseTo(3.8, 6)
    expect(r.elevation?.estimated).toBe(false)
  })

  it('straight-line fallback → elevation stays estimated (estimated = source !== "osrm")', async () => {
    mockFetch((url) => (url.includes('routing.openstreetmap.de') ? jsonResponse({}, 503) : elevationResponse(url)))
    const r = await realServices.routeDetail(origin, place)
    expect(r.route.source).toBe('straight')
    expect(r.elevation).not.toBeNull()
    expect(r.elevation?.estimated).toBe(true)
  })

  it('demo routes are straight lines, so they are estimated too', async () => {
    const r = await demoServices.routeDetail(origin, { ...place, source: 'mock' })
    expect(r.route.source).toBe('straight')
    expect(r.elevation?.estimated).toBe(true)
  })
})
