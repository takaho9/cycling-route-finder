import { fetchElevationSummaries, fetchRouteElevationSummary, routeSampleCount, summarizeElevation } from './elevation'
import { samplePolyline } from './geo'
import { geocode, PRESET_ORIGINS, reverseGeocode, type GeocodeHit } from './geocode'
import { resolvePhotos, type PhotoInfo } from './photos'
import { createDemoProviders, searchPlaces, type SearchResult } from './places'
import { mockElevationProfile } from './places/mock'
import { fetchRoute, straightRoute, type RouteResult } from './routing'
import type { ElevationSummary, LatLng, Place } from './types'

/**
 * UI から使う外部アクセスの窓口。?demo=1 では一切ネットワークに出ない実装に差し替える。
 */
export interface Services {
  demo: boolean
  search(center: LatLng, signal?: AbortSignal): Promise<SearchResult>
  elevations(origin: LatLng, places: readonly Place[], signal?: AbortSignal): Promise<Map<string, ElevationSummary | null>>
  photos(places: readonly Place[], width: number, signal?: AbortSignal): Promise<Map<string, PhotoInfo | null>>
  /** 詳細表示時のみ呼ぶ（経路＋経路沿いの標高） */
  routeDetail(origin: LatLng, place: Place, signal?: AbortSignal): Promise<{ route: RouteResult; elevation: ElevationSummary | null }>
  geocode(query: string, signal?: AbortSignal): Promise<GeocodeHit[]>
  placeName(p: LatLng, signal?: AbortSignal): Promise<string | null>
}

function mockRouteDetail(origin: LatLng, place: Place) {
  const route = straightRoute(origin, place)
  const bonus = place.category === 'viewpoint' ? 40 : 0
  const profile = mockElevationProfile(origin, place, bonus, routeSampleCount(route.distanceKm))
  return { route, elevation: summarizeElevation(profile, route.distanceKm, { estimated: false }) }
}

export const realServices: Services = {
  demo: false,
  search: (center, signal) => searchPlaces(center, { signal }),
  elevations: (origin, places, signal) =>
    fetchElevationSummaries(
      origin,
      places.filter((p) => p.source !== 'mock'),
      { signal },
    ),
  photos: (places, width, signal) =>
    resolvePhotos(
      places.filter((p) => p.source !== 'mock'),
      { width, signal },
    ),
  async routeDetail(origin, place, signal) {
    if (place.source === 'mock') return mockRouteDetail(origin, place)
    const route = await fetchRoute(origin, place, { signal })
    const path = samplePolyline(route.path, routeSampleCount(route.distanceKm))
    const elevation = await fetchRouteElevationSummary(path, route.distanceKm, { signal }).catch((e) => {
      if (signal?.aborted) throw e
      return null
    })
    return { route, elevation }
  },
  geocode: (q, signal) => geocode(q, { signal }),
  placeName: (p, signal) => reverseGeocode(p, { signal }),
}

export const demoServices: Services = {
  demo: true,
  search: (center, signal) => searchPlaces(center, { signal, providers: createDemoProviders(), useCache: false }),
  elevations: async () => new Map(),
  photos: async () => new Map(),
  routeDetail: async (origin, place) => mockRouteDetail(origin, place),
  geocode: async (q) => PRESET_ORIGINS.filter((o) => o.label.includes(q.trim())),
  placeName: async () => null,
}

/** ?demo=1 でモック強制（スクリーンショット・E2E 用） */
export function isDemoMode(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  try {
    return new URLSearchParams(search).get('demo') === '1'
  } catch {
    return false
  }
}
