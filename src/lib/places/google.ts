import { bearingDeg, haversineKm } from '../geo'
import { fetchJson, isAbortError } from '../http'
import type { Category, LatLng, Place, PlaceProvider } from '../types'
import { balancedSample, dedupeByName, filterDonut, MAX_CANDIDATES } from './sampling'

export const GOOGLE_NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby'
export const GOOGLE_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.types',
  'places.primaryType',
  'places.photos',
  'places.rating',
  'places.userRatingCount',
].join(',')
/** searchNearby の radius 上限 (m) */
const MAX_RADIUS_M = 50_000

/**
 * カテゴリごとに別リクエストにする（1 リクエスト最大 20 件・未知の type が 1 つでもあると 400 になるため、
 * 失敗をグループ単位に閉じ込める）。
 * NOTE: shinto_shrine / buddhist_temple / observation_deck / historical_landmark / rest_stop / beach 等は
 * Places API (New) の Table A に後から追加された type。実キーで要検証。
 */
export const GOOGLE_TYPE_GROUPS: readonly { category: Category; includedTypes: string[] }[] = [
  { category: 'park', includedTypes: ['park', 'garden', 'national_park'] },
  { category: 'viewpoint', includedTypes: ['observation_deck'] },
  { category: 'cafe', includedTypes: ['cafe', 'coffee_shop'] },
  { category: 'bakery', includedTypes: ['bakery'] },
  { category: 'shrine', includedTypes: ['shinto_shrine', 'buddhist_temple'] },
  { category: 'historic', includedTypes: ['historical_landmark'] },
  { category: 'waterside', includedTypes: ['beach', 'marina'] },
  { category: 'attraction', includedTypes: ['tourist_attraction'] },
  { category: 'roadside_station', includedTypes: ['rest_stop'] },
]

interface GooglePlace {
  id: string
  displayName?: { text: string; languageCode?: string }
  location?: { latitude: number; longitude: number }
  types?: string[]
  primaryType?: string
  photos?: { name: string; widthPx?: number; heightPx?: number }[]
  rating?: number
  userRatingCount?: number
}

export function googlePhotoUrl(photoName: string, apiKey: string, maxWidthPx = 800): string {
  return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidthPx}&key=${encodeURIComponent(apiKey)}`
}

const TYPE_TO_CATEGORY: Record<string, Category> = {
  park: 'park',
  garden: 'park',
  national_park: 'park',
  observation_deck: 'viewpoint',
  cafe: 'cafe',
  coffee_shop: 'cafe',
  bakery: 'bakery',
  shinto_shrine: 'shrine',
  buddhist_temple: 'shrine',
  place_of_worship: 'shrine',
  historical_landmark: 'historic',
  historical_place: 'historic',
  beach: 'waterside',
  marina: 'waterside',
  tourist_attraction: 'attraction',
  rest_stop: 'roadside_station',
}

export function categorizeGoogleTypes(primaryType: string | undefined, types: readonly string[] = []): Category {
  if (primaryType && TYPE_TO_CATEGORY[primaryType]) return TYPE_TO_CATEGORY[primaryType]
  for (const t of types) if (TYPE_TO_CATEGORY[t]) return TYPE_TO_CATEGORY[t]
  return 'other'
}

export function parseGooglePlace(g: GooglePlace, center: LatLng, apiKey: string, fallback: Category): Place | null {
  const name = g.displayName?.text
  if (!g.id || !name || !g.location) return null
  const pos = { lat: g.location.latitude, lng: g.location.longitude }
  const category = categorizeGoogleTypes(g.primaryType, g.types)
  const photoName = g.photos?.[0]?.name
  const tags: Record<string, string> = { google_place_id: g.id }
  if (photoName) tags.google_photo = photoName
  if (g.rating !== undefined) tags.rating = String(g.rating)
  if (g.userRatingCount !== undefined) tags.user_rating_count = String(g.userRatingCount)
  return {
    id: `google:${g.id}`,
    name,
    lat: pos.lat,
    lng: pos.lng,
    category: category === 'other' ? fallback : category,
    distanceKm: haversineKm(center, pos),
    bearing: bearingDeg(center, pos),
    tags,
    photoUrl: photoName ? googlePhotoUrl(photoName, apiKey) : undefined,
    source: 'google',
  }
}

export interface GoogleProviderOptions {
  apiKey: string
  timeoutMs?: number
  maxResults?: number
  languageCode?: string
}

export function createGoogleProvider({
  apiKey,
  timeoutMs = 10_000,
  maxResults = MAX_CANDIDATES,
  languageCode = 'ja',
}: GoogleProviderOptions): PlaceProvider {
  return {
    name: 'google',
    async search(center, minKm, maxKm, signal) {
      const radius = Math.min(MAX_RADIUS_M, Math.round(maxKm * 1000))
      const settled = await Promise.allSettled(
        GOOGLE_TYPE_GROUPS.map(async (group) => {
          const json = await fetchJson<{ places?: GooglePlace[] }>(
            GOOGLE_NEARBY_URL,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': GOOGLE_FIELD_MASK,
              },
              body: JSON.stringify({
                includedTypes: group.includedTypes,
                maxResultCount: 20,
                rankPreference: 'POPULARITY',
                languageCode,
                locationRestriction: {
                  circle: { center: { latitude: center.lat, longitude: center.lng }, radius },
                },
              }),
            },
            { signal, timeoutMs },
          )
          return (json.places ?? [])
            .map((g) => parseGooglePlace(g, center, apiKey, group.category))
            .filter((p): p is Place => p !== null)
        }),
      )
      if (signal?.aborted) {
        const e = new Error('The operation was aborted')
        e.name = 'AbortError'
        throw e
      }
      const ok = settled.filter((s): s is PromiseFulfilledResult<Place[]> => s.status === 'fulfilled')
      if (ok.length === 0) {
        const first = settled[0]
        throw first && first.status === 'rejected' ? first.reason : new Error('Google Places: all requests failed')
      }
      settled.forEach((s, i) => {
        if (s.status === 'rejected' && !isAbortError(s.reason)) {
          console.warn(`[google] group ${GOOGLE_TYPE_GROUPS[i].category} failed`, s.reason)
        }
      })
      const seen = new Set<string>()
      const all = ok.flatMap((s) => s.value).filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
      return balancedSample(dedupeByName(filterDonut(all, minKm, maxKm)), maxResults)
    },
  }
}
