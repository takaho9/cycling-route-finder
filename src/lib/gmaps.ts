import type { LatLng } from './types'

/**
 * Google マップの「経路」URL（Maps URLs, API キー不要・無料）。
 * https://developers.google.com/maps/documentation/urls/get-started#directions-action
 * 遷移は <a href target="_blank" rel="noopener"> で行う（window.open に頼らない, BACKLOG R4）。
 */
export const GMAPS_DIR_BASE = 'https://www.google.com/maps/dir/'

export type TravelMode = 'bicycling' | 'walking'

/** 目的地（他人の場所なので精度を落とさない） */
export const formatLatLng = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`
/** 出発地（ユーザーの位置なので約 11m に丸める, BACKLOG Y6） */
export const formatOrigin = (p: LatLng) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`

function build(params: [string, string | undefined][]): string {
  const qs = params
    .filter((kv): kv is [string, string] => kv[1] !== undefined && kv[1] !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  return `${GMAPS_DIR_BASE}?${qs}`
}

/**
 * 片道: origin は省略（Google マップ側で現在地が使われる）+ dir_action=navigate で即ナビ開始。
 */
export function buildOneWayUrl({ destination, travelmode = 'bicycling' }: { destination: LatLng; travelmode?: TravelMode }): string {
  return build([
    ['api', '1'],
    ['destination', formatLatLng(destination)],
    ['travelmode', travelmode],
    ['dir_action', 'navigate'],
  ])
}

/**
 * 往復: origin は省略（現在地）、destination = 出発地、waypoints = 目的地。
 * 出発地が仮（デモ地点）のときは使わないこと（BACKLOG A6）。
 */
export function buildRoundTripUrl({
  start,
  destination,
  travelmode = 'bicycling',
}: {
  start: LatLng
  destination: LatLng
  travelmode?: TravelMode
}): string {
  return build([
    ['api', '1'],
    ['destination', formatOrigin(start)],
    ['waypoints', formatLatLng(destination)],
    ['travelmode', travelmode],
  ])
}
