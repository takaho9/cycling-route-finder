import { fetchJson, isAbortError, mapWithConcurrency, type RequestOptions } from './http'
import { haversineKm, interpolateLine } from './geo'
import type { ElevationLabel, ElevationSummary, LatLng } from './types'

/** ラベル判定の閾値 (往復の獲得標高 / 往復距離, m/km)。後で調整しやすいよう定数化 */
export const ELEVATION_THRESHOLDS = {
  /** これ未満なら flat */
  flatMaxGainPerKm: 8,
  /** これ未満なら rolling、以上なら hilly */
  rollingMaxGainPerKm: 20,
} as const

export type ElevationThresholds = { flatMaxGainPerKm: number; rollingMaxGainPerKm: number }

export const OPEN_METEO_ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation'
/** Open-Meteo Elevation API の 1 リクエストあたり最大座標数 */
export const OPEN_METEO_MAX_POINTS = 100
/** 一覧用: 候補 1 件あたりのサンプル点数（出発地を含む） */
export const DEFAULT_SAMPLES_PER_ROUTE = 10

export function classifyElevation(
  gainPerKm: number,
  thresholds: ElevationThresholds = ELEVATION_THRESHOLDS,
): ElevationLabel {
  if (gainPerKm < thresholds.flatMaxGainPerKm) return 'flat'
  if (gainPerKm < thresholds.rollingMaxGainPerKm) return 'rolling'
  return 'hilly'
}

export interface SummarizeOptions {
  thresholds?: ElevationThresholds
  /**
   * 上り/下りを確定させるヒステリシス (m)。DEM ノイズによる獲得標高の過大評価を抑える。
   * 0 なら単純な正の差分の合計。
   */
  noiseThresholdM?: number
}

/**
 * 等間隔にサンプリングされた標高配列 (出発地→目的地) と片道距離から標高サマリを計算。
 */
export function summarizeElevation(
  elevations: readonly number[],
  distanceKm: number,
  { thresholds = ELEVATION_THRESHOLDS, noiseThresholdM = 0 }: SummarizeOptions = {},
): ElevationSummary {
  const profile = elevations.filter((e) => Number.isFinite(e))
  let gain = 0
  let loss = 0
  let maxGrade = 0
  if (profile.length >= 2) {
    const segM = (distanceKm * 1000) / (profile.length - 1)
    if (segM > 0) {
      for (let i = 1; i < profile.length; i++) {
        maxGrade = Math.max(maxGrade, (Math.abs(profile[i] - profile[i - 1]) / segM) * 100)
      }
    }
    // ヒステリシス付き累積
    let ref = profile[0]
    for (let i = 1; i < profile.length; i++) {
      const d = profile[i] - ref
      if (d > noiseThresholdM) {
        gain += d
        ref = profile[i]
      } else if (-d > noiseThresholdM) {
        loss += -d
        ref = profile[i]
      }
    }
  }
  const gainRoundTrip = gain + loss
  const gainPerKm = distanceKm > 0 ? gainRoundTrip / (distanceKm * 2) : 0
  return {
    gainOneWayM: round1(gain),
    lossOneWayM: round1(loss),
    gainRoundTripM: round1(gainRoundTrip),
    maxGradePct: round1(maxGrade),
    gainPerKm: round1(gainPerKm),
    label: classifyElevation(gainPerKm, thresholds),
    profile: [...profile],
    distanceKm,
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10

// ---------------------------------------------------------------------------
// Open-Meteo client
// ---------------------------------------------------------------------------

const pointKey = (p: LatLng) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`
/** セッション内キャッシュ（約 11m 単位で丸めたキー） */
const elevationCache = new Map<string, number>()

export function clearElevationCache(): void {
  elevationCache.clear()
}

interface OpenMeteoElevationResponse {
  elevation?: number[]
}

export function buildElevationUrl(points: readonly LatLng[]): string {
  const lat = points.map((p) => p.lat.toFixed(5)).join(',')
  const lng = points.map((p) => p.lng.toFixed(5)).join(',')
  return `${OPEN_METEO_ELEVATION_URL}?latitude=${lat}&longitude=${lng}`
}

export interface ElevationFetchOptions extends RequestOptions {
  /** 並列リクエスト数（既定 2） */
  concurrency?: number
}

/**
 * 任意個の座標の標高を取得。100 点ずつにバッチ化し、キャッシュ済みの点は再取得しない。
 * いずれかのバッチが失敗（abort 含む）したら null。
 */
export async function fetchElevations(
  points: readonly LatLng[],
  { signal, timeoutMs = 10_000, concurrency = 2 }: ElevationFetchOptions = {},
): Promise<number[] | null> {
  const keys = points.map(pointKey)
  const missing: LatLng[] = []
  const seen = new Set<string>()
  points.forEach((p, i) => {
    const k = keys[i]
    if (!elevationCache.has(k) && !seen.has(k)) {
      seen.add(k)
      missing.push(p)
    }
  })
  const batches: LatLng[][] = []
  for (let i = 0; i < missing.length; i += OPEN_METEO_MAX_POINTS) {
    batches.push(missing.slice(i, i + OPEN_METEO_MAX_POINTS))
  }
  try {
    await mapWithConcurrency(batches, concurrency, async (batch) => {
      const json = await fetchJson<OpenMeteoElevationResponse>(buildElevationUrl(batch), undefined, {
        signal,
        timeoutMs,
      })
      const elev = json.elevation
      if (!Array.isArray(elev) || elev.length !== batch.length) throw new Error('Unexpected elevation response')
      batch.forEach((p, i) => {
        if (typeof elev[i] === 'number' && Number.isFinite(elev[i])) elevationCache.set(pointKey(p), elev[i])
      })
    })
  } catch (e) {
    if (!isAbortError(e)) console.warn('[elevation] fetch failed', e)
    return null
  }
  const out: number[] = []
  for (const k of keys) {
    const v = elevationCache.get(k)
    if (v === undefined) return null
    out.push(v)
  }
  return out
}

/**
 * 一覧用: 出発地から各候補までを直線補間でサンプリングし、まとめてバッチ取得して標高サマリを返す。
 * 取得失敗時は全件 null。
 */
export async function fetchElevationSummaries(
  origin: LatLng,
  destinations: readonly (LatLng & { id: string })[],
  {
    samplesPerRoute = DEFAULT_SAMPLES_PER_ROUTE,
    summarize,
    ...opts
  }: ElevationFetchOptions & { samplesPerRoute?: number; summarize?: SummarizeOptions } = {},
): Promise<Map<string, ElevationSummary | null>> {
  const result = new Map<string, ElevationSummary | null>()
  if (destinations.length === 0) return result
  const routes = destinations.map((d) => interpolateLine(origin, d, samplesPerRoute))
  const elevations = await fetchElevations(routes.flat(), opts)
  destinations.forEach((d, i) => {
    if (!elevations) {
      result.set(d.id, null)
      return
    }
    const slice = elevations.slice(i * samplesPerRoute, (i + 1) * samplesPerRoute)
    result.set(d.id, summarizeElevation(slice, haversineKm(origin, d), summarize))
  })
  return result
}

/**
 * 詳細用: 経路形状（OSRM 等）を受け取り、等間隔サンプリングして標高サマリを返す。失敗時 null。
 */
export async function fetchRouteElevationSummary(
  sampledPath: readonly LatLng[],
  distanceKm: number,
  opts: ElevationFetchOptions & { summarize?: SummarizeOptions } = {},
): Promise<ElevationSummary | null> {
  const { summarize, ...rest } = opts
  const elevations = await fetchElevations(sampledPath, rest)
  return elevations ? summarizeElevation(elevations, distanceKm, summarize) : null
}
