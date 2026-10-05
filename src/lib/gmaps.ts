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
 * 片道: 既定は origin を省略（Google マップ側で現在地が使われる）+ dir_action=navigate で即ナビ開始。
 * origin を渡すと（手動で選んだ出発地, BACKLOG-2 C10）origin= を明示し、dir_action は付けない。
 */
export function buildOneWayUrl({
  destination,
  origin,
  travelmode = 'bicycling',
}: {
  destination: LatLng
  origin?: LatLng
  travelmode?: TravelMode
}): string {
  return build([
    ['api', '1'],
    ['origin', origin ? formatOrigin(origin) : undefined],
    ['destination', formatLatLng(destination)],
    ['travelmode', travelmode],
    ['dir_action', origin ? undefined : 'navigate'],
  ])
}

/**
 * 往復: 既定は origin 省略（現在地）、destination = 出発地、waypoints = 目的地。
 * explicitOrigin=true（手動で選んだ出発地, C10）なら origin= にも出発地を明示する。
 * 出発地が仮（デモ地点）のときは使わないこと（BACKLOG A6）。
 */
export function buildRoundTripUrl({
  start,
  destination,
  explicitOrigin = false,
  travelmode = 'bicycling',
}: {
  start: LatLng
  destination: LatLng
  explicitOrigin?: boolean
  travelmode?: TravelMode
}): string {
  return build([
    ['api', '1'],
    ['origin', explicitOrigin ? formatOrigin(start) : undefined],
    ['destination', formatOrigin(start)],
    ['waypoints', formatLatLng(destination)],
    ['travelmode', travelmode],
  ])
}

export type StartKind = 'gps' | 'manual' | 'demo'

/**
 * 出発ボタンの URL を一か所で決める。
 * - demo（仮の出発地）: 往復は使わず片道・origin 省略（A6）
 * - manual（手動で選んだ出発地）: 片道・往復とも origin= を明示（C10）
 * - gps: origin 省略（Google マップの現在地）
 */
export function buildDepartUrl({
  mode,
  start,
  destination,
  travelmode,
}: {
  mode: 'oneway' | 'round'
  start: LatLng & { kind: StartKind }
  destination: LatLng
  travelmode?: TravelMode
}): string {
  if (start.kind === 'demo') return buildOneWayUrl({ destination, travelmode })
  const manual = start.kind === 'manual'
  return mode === 'round'
    ? buildRoundTripUrl({ start, destination, explicitOrigin: manual, travelmode })
    : buildOneWayUrl({ destination, origin: manual ? start : undefined, travelmode })
}
