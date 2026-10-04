import type { LatLng } from './types'

const rad = Math.PI / 180
const J2000 = 2451545.0
const toJulian = (ms: number) => ms / 86400000 + 2440587.5
const fromJulian = (j: number) => (j - 2440587.5) * 86400000

/**
 * 日の出・日の入り（NOAA の簡易式, 誤差 ±1〜2 分）。API 不要のローカル計算。
 * 極夜・白夜では null。
 */
export function sunTimes(date: Date, p: LatLng): { sunrise: Date; sunset: Date } | null {
  // その日のローカル正午を基準にする
  const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)
  const n = Math.round(toJulian(noon.getTime()) - J2000 + 0.0008)
  const jStar = n - p.lng / 360
  const M = (357.5291 + 0.98560028 * jStar) % 360
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad)
  const lambda = (M + C + 180 + 102.9372) % 360
  const jTransit = J2000 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad)
  const sinDec = Math.sin(lambda * rad) * Math.sin(23.4397 * rad)
  const cosDec = Math.cos(Math.asin(sinDec))
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(p.lat * rad) * sinDec) / (Math.cos(p.lat * rad) * cosDec)
  if (cosW < -1 || cosW > 1) return null
  const w = Math.acos(cosW) / rad
  return { sunrise: new Date(fromJulian(jTransit - w / 360)), sunset: new Date(fromJulian(jTransit + w / 360)) }
}

export type DaylightStatus =
  | { kind: 'day'; minutesToSunset: number; returnsAfterSunset: boolean }
  | { kind: 'night' }
  | { kind: 'unknown' }

/**
 * 日没までの残り時間と、往復 plannedMin で日没後に帰着しそうか（BACKLOG: 日没までの残り時間）。
 */
export function daylightStatus(now: Date, p: LatLng, plannedMin: number): DaylightStatus {
  const t = sunTimes(now, p)
  if (!t) return { kind: 'unknown' }
  if (now < t.sunrise || now >= t.sunset) return { kind: 'night' }
  const minutesToSunset = Math.floor((t.sunset.getTime() - now.getTime()) / 60000)
  return { kind: 'day', minutesToSunset, returnsAfterSunset: plannedMin > minutesToSunset }
}
