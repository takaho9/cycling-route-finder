import { abortError, fetchJson, sleep, type RequestOptions } from './http'
import type { LatLng } from './types'

/**
 * 出発地の手動指定用 Nominatim クライアント（BACKLOG R8）。
 * 利用規約に従い「確定時のみ」呼ぶ（入力補完に使わない）・1 秒 1 件に制限。
 */
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org'
const MIN_INTERVAL_MS = 1100
let lastCall = 0
/** 直列化のための Promise チェーン（BACKLOG-2 C20）。同時に呼ばれても 1 件ずつ、間隔をあけて投げる */
let chain: Promise<unknown> = Promise.resolve()

export interface GeocodeHit extends LatLng {
  label: string
}

/**
 * Nominatim へのリクエストを直列化し、前回の送信から MIN_INTERVAL_MS 空ける。
 * 同時に 2 件来ても、前の呼び出しが終わってから次を投げる（並行に投げて 1 秒 1 件を破らない）。
 */
function serialized<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastCall + MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await sleep(wait, signal)
    else if (signal?.aborted) throw abortError()
    lastCall = Date.now()
    return task()
  })
  chain = run.catch(() => {})
  return run
}

/** テスト用 */
export function resetGeocodeThrottle(): void {
  lastCall = 0
  chain = Promise.resolve()
}

interface NominatimHit {
  lat: string
  lon: string
  display_name: string
  name?: string
}

/** 住所・駅名などを検索（確定時のみ呼ぶこと） */
export async function geocode(query: string, opts: RequestOptions = {}): Promise<GeocodeHit[]> {
  const q = query.trim()
  if (!q) return []
  const url = `${NOMINATIM_URL}/search?format=jsonv2&limit=5&accept-language=ja&countrycodes=jp&q=${encodeURIComponent(q)}`
  const hits = await serialized(() => fetchJson<NominatimHit[]>(url, undefined, { timeoutMs: 8_000, ...opts }), opts.signal)
  return (Array.isArray(hits) ? hits : [])
    .map((h) => ({
      lat: Number(h.lat),
      lng: Number(h.lon),
      label: h.name || h.display_name.split(',')[0],
    }))
    .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng))
}

/** 位置情報が使えないときの代表地点（オフラインでも選べる） */
export const PRESET_ORIGINS: GeocodeHit[] = [
  { label: '東京駅', lat: 35.681236, lng: 139.767125 },
  { label: '新宿駅', lat: 35.690921, lng: 139.700258 },
  { label: '大阪駅', lat: 34.702485, lng: 135.495951 },
  { label: '名古屋駅', lat: 35.170915, lng: 136.881537 },
  { label: '京都駅', lat: 34.985849, lng: 135.758767 },
  { label: '札幌駅', lat: 43.068661, lng: 141.350755 },
  { label: '博多駅', lat: 33.589886, lng: 130.420685 },
]

interface NominatimReverse {
  address?: Record<string, string>
}

/** 現在地ピル用の地名（座標は小数 3 桁に丸めて送る）。失敗時 null */
export async function reverseGeocode(p: LatLng, opts: RequestOptions = {}): Promise<string | null> {
  try {
    const url = `${NOMINATIM_URL}/reverse?format=jsonv2&zoom=16&accept-language=ja&lat=${p.lat.toFixed(3)}&lon=${p.lng.toFixed(3)}`
    const json = await serialized(() => fetchJson<NominatimReverse>(url, undefined, { timeoutMs: 6_000, ...opts }), opts.signal)
    const a = json.address ?? {}
    const city = a.city_district ?? a.city ?? a.town ?? a.village ?? a.county ?? ''
    const area = a.suburb ?? a.quarter ?? a.neighbourhood ?? ''
    const label = `${city}${area}`.trim()
    return label || null
  } catch (e) {
    if (opts.signal?.aborted) throw e
    return null
  }
}
