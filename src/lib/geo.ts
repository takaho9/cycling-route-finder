import type { LatLng } from './types'

export const EARTH_RADIUS_KM = 6371.0088

const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI

/** 0〜360 に正規化 */
export function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** 2点間の大圏距離 (km) */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** a から b への初期方位 (度, 0=北, 時計回り, 0〜360) */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat)
  const φ2 = toRad(b.lat)
  const Δλ = toRad(b.lng - a.lng)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return normalizeBearing(toDeg(Math.atan2(y, x)))
}

/** origin から方位 bearing へ distanceKm 進んだ点 */
export function destinationPoint(origin: LatLng, bearing: number, distanceKm: number): LatLng {
  const δ = distanceKm / EARTH_RADIUS_KM
  const θ = toRad(bearing)
  const φ1 = toRad(origin.lat)
  const λ1 = toRad(origin.lng)
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ))
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2))
  return { lat: toDeg(φ2), lng: ((toDeg(λ2) + 540) % 360) - 180 }
}

/**
 * a→b を count 点で等間隔サンプリング（両端含む）。
 * 数 km〜数十 km の範囲なので線形補間で十分。
 */
export function interpolateLine(a: LatLng, b: LatLng, count: number): LatLng[] {
  if (count < 2) throw new RangeError('count must be >= 2')
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }
  })
}

export function polylineLengthKm(points: readonly LatLng[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i++) sum += haversineKm(points[i - 1], points[i])
  return sum
}

/** ポリライン上を距離ベースで count 点に等間隔リサンプリング（両端含む） */
export function samplePolyline(points: readonly LatLng[], count: number): LatLng[] {
  if (count < 2) throw new RangeError('count must be >= 2')
  if (points.length === 0) return []
  if (points.length === 1) return Array.from({ length: count }, () => ({ ...points[0] }))
  const cum = [0]
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + haversineKm(points[i - 1], points[i]))
  const total = cum[cum.length - 1]
  if (total === 0) return Array.from({ length: count }, () => ({ ...points[0] }))
  const out: LatLng[] = []
  let seg = 1
  for (let i = 0; i < count; i++) {
    const target = (total * i) / (count - 1)
    while (seg < points.length - 1 && cum[seg] < target) seg++
    const segLen = cum[seg] - cum[seg - 1]
    const t = segLen === 0 ? 0 : Math.min(1, Math.max(0, (target - cum[seg - 1]) / segLen))
    const p = points[seg - 1]
    const q = points[seg]
    out.push({ lat: p.lat + (q.lat - p.lat) * t, lng: p.lng + (q.lng - p.lng) * t })
  }
  return out
}

const COMPASS_JA = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'] as const

/** 方位を 8 方位の日本語ラベルに */
export function bearingToCompassJa(bearing: number): (typeof COMPASS_JA)[number] {
  return COMPASS_JA[Math.round(normalizeBearing(bearing) / 45) % 8]
}

/** 方位を sectors 個のセクタ番号 (0..sectors-1) に。セクタ0は北を中心とする */
export function bearingSector(bearing: number, sectors = 8): number {
  const width = 360 / sectors
  return Math.floor(normalizeBearing(bearing + width / 2) / width) % sectors
}
