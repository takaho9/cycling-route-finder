import type { LatLng } from './types'

export const GMAPS_DIR_BASE = 'https://www.google.com/maps/dir/'

export type TravelMode = 'bicycling' | 'walking' | 'driving' | 'transit'

export interface DirectionsParams {
  /** 省略時は Google マップ側で現在地が使われる（片道のみ） */
  origin?: LatLng
  destination: LatLng
  /** Google Places の place_id（あれば目的地をより正確に指定できる） */
  destinationPlaceId?: string
  travelmode?: TravelMode
}

export const formatLatLng = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`

function build(params: [string, string | undefined][]): string {
  const qs = params
    .filter((kv): kv is [string, string] => kv[1] !== undefined && kv[1] !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  return `${GMAPS_DIR_BASE}?${qs}`
}

/** 片道: origin → destination */
export function buildOneWayUrl({ origin, destination, destinationPlaceId, travelmode = 'bicycling' }: DirectionsParams): string {
  return build([
    ['api', '1'],
    ['origin', origin ? formatLatLng(origin) : undefined],
    ['destination', formatLatLng(destination)],
    ['destination_place_id', destinationPlaceId],
    ['travelmode', travelmode],
  ])
}

/** 往復: origin=現在地, destination=現在地, waypoints=目的地 */
export function buildRoundTripUrl({
  origin,
  destination,
  destinationPlaceId,
  travelmode = 'bicycling',
}: DirectionsParams & { origin: LatLng }): string {
  const o = formatLatLng(origin)
  return build([
    ['api', '1'],
    ['origin', o],
    ['destination', o],
    ['waypoints', formatLatLng(destination)],
    ['waypoint_place_ids', destinationPlaceId],
    ['travelmode', travelmode],
  ])
}

/** google:ChIJ... 形式の Place.id から place_id を取り出す */
export function googlePlaceIdFromId(id: string): string | undefined {
  return id.startsWith('google:') ? id.slice('google:'.length) : undefined
}
