import { fetchJson, isAbortError, mapWithConcurrency, type RequestOptions } from './http'
import { haversineKm, interpolateLine } from './geo'
import type { ElevationLabel, ElevationSummary, LatLng } from './types'

/**
 * 高低差ラベルの判定基準（DESIGN.md §4 / BACKLOG R1・A8）。後で調整しやすいよう定数化。
 * G = max(往路の獲得標高, 復路の獲得標高)、R = G ÷ 片道距離(km)。上から順に判定:
 * - hilly:   R >= 15 m/km || G >= 150 m || 最大勾配 >= 8 %（勾配条件は経路形状のある詳細でのみ）
 * - rolling: R >= 6 m/km  || G >= 40 m
 * - flat:    それ以外
 */
export const ELEVATION_RULES = {
  hillyMinClimbPerKm: 15,
  hillyMinClimbM: 150,
  hillyMinGradePct: 8,
  rollingMinClimbPerKm: 6,
  rollingMinClimbM: 40,
  /** 勾配はこの距離 (m) 以上の窓で平滑化して評価（DEM ノイズ対策, BACKLOG A8） */
  minGradeSegmentM: 300,
} as const

export type ElevationRules = { -readonly [K in keyof typeof ELEVATION_RULES]: number }

/** 獲得標高のヒステリシス既定値 (m, BACKLOG A8) */
export const DEFAULT_NOISE_THRESHOLD_M = 5
/**
 * 水面判定（BACKLOG-2 C8）: 始点と終点が 0m より上で、その間の標高 <= 0m がこの数以上連続したら「水面を横切るかも」。
 * 始点か終点が 0m 以下（ゼロメートル地帯）のときは判定しない。
 */
export const SEA_RUN_THRESHOLD = 3

export const OPEN_METEO_ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation'
/** Open-Meteo Elevation API の 1 リクエストあたり最大座標数 */
export const OPEN_METEO_MAX_POINTS = 100
/** 一覧用: 候補 1 件あたりのサンプル点数（出発地を含む） */
export const DEFAULT_SAMPLES_PER_ROUTE = 10
/** 外部に送る座標の桁数（約 11m） */
const COORD_DECIMALS = 4

export function classifyElevation(
  { climbM, climbPerKm, maxGradePct }: { climbM: number; climbPerKm: number; maxGradePct?: number },
  rules: ElevationRules = ELEVATION_RULES,
): ElevationLabel {
  const steep = maxGradePct !== undefined && maxGradePct >= rules.hillyMinGradePct
  if (climbPerKm >= rules.hillyMinClimbPerKm || climbM >= rules.hillyMinClimbM || steep) {
    return 'hilly'
  }
  if (climbPerKm >= rules.rollingMinClimbPerKm || climbM >= rules.rollingMinClimbM) return 'rolling'
  return 'flat'
}

export interface SummarizeOptions {
  rules?: ElevationRules
  /** 上り/下りを確定させるヒステリシス (m)。既定 5m */
  noiseThresholdM?: number
  /**
   * true（既定）: 一覧用の推定。最大勾配はラベル判定に使わない（直線補間では信用できないため）。
   * false: 経路形状に沿った確定値。最大勾配 >= 8% も 🔴 判定に使う。
   */
  estimated?: boolean
}

/**
 * 平滑化した最大勾配 (%)。各点 i から、距離が minSegM 以上離れた最初の点 j までの平均勾配の最大値。
 * 全長が minSegM 未満なら全区間の平均勾配。
 */
export function smoothedMaxGradePct(elev: readonly number[], km: readonly number[], minSegM: number): number {
  const n = Math.min(elev.length, km.length)
  if (n < 2) return 0
  const totalM = (km[n - 1] - km[0]) * 1000
  if (!(totalM > 0)) return 0
  if (totalM < minSegM) return (Math.abs(elev[n - 1] - elev[0]) / totalM) * 100
  let max = 0
  let j = 0
  for (let i = 0; i < n; i++) {
    if (j <= i) j = i + 1
    while (j < n && (km[j] - km[i]) * 1000 < minSegM) j++
    if (j >= n) break
    const g = (Math.abs(elev[j] - elev[i]) / ((km[j] - km[i]) * 1000)) * 100
    if (g > max) max = g
  }
  return max
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * 出発地→目的地の等間隔サンプルの標高（欠損は null/NaN）と片道距離から標高サマリを計算。
 * 欠損点は除外し、残った点は本来の距離位置で評価する。有効点が 2 未満なら null。
 */
export function summarizeElevation(
  elevations: readonly (number | null | undefined)[],
  distanceKm: number,
  { rules = ELEVATION_RULES, noiseThresholdM = DEFAULT_NOISE_THRESHOLD_M, estimated = true }: SummarizeOptions = {},
): ElevationSummary {
  const step = elevations.length > 1 ? distanceKm / (elevations.length - 1) : 0
  const profile: number[] = []
  const profileKm: number[] = []
  elevations.forEach((e, i) => {
    if (typeof e === 'number' && Number.isFinite(e)) {
      profile.push(e)
      profileKm.push(i * step)
    }
  })
  const seaRun = interiorSeaRun(profile)
  let gain = 0
  let loss = 0
  if (profile.length >= 2) {
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
  const maxGrade = smoothedMaxGradePct(profile, profileKm, rules.minGradeSegmentM)
  const climb = Math.max(gain, loss)
  const climbPerKm = distanceKm > 0 ? climb / distanceKm : 0
  const summary = {
    gainOneWayM: round1(gain),
    lossOneWayM: round1(loss),
    gainRoundTripM: round1(gain + loss),
    maxGradePct: round1(maxGrade),
    climbM: round1(climb),
    climbPerKm: round1(climbPerKm),
    profile,
    profileKm,
    distanceKm,
    seaRun,
    estimated,
  }
  const label = classifyElevation({ climbM: climb, climbPerKm, maxGradePct: estimated ? undefined : maxGrade }, rules)
  return { ...summary, label }
}

/**
 * 始点・終点が 0m より上のときだけ、その間で標高 <= 0m が連続した最大数（C8）。
 * 始点か終点が 0m 以下（ゼロメートル地帯・埋立地）なら 0。
 */
export function interiorSeaRun(profile: readonly number[]): number {
  const n = profile.length
  if (n < 3 || !(profile[0] > 0) || !(profile[n - 1] > 0)) return 0
  let max = 0
  let run = 0
  for (let i = 1; i < n - 1; i++) {
    run = profile[i] <= 0 ? run + 1 : 0
    if (run > max) max = run
  }
  return max
}

/** 直線サンプルが海上・水面を横切っていそうか（R5/C8: 一覧の並びを下げる目安。おすすめには使わない） */
export function looksLikeWaterCrossing(s: Pick<ElevationSummary, 'seaRun'> | null | undefined): boolean {
  return !!s && s.seaRun >= SEA_RUN_THRESHOLD
}

// ---------------------------------------------------------------------------
// Open-Meteo client
// ---------------------------------------------------------------------------

const pointKey = (p: LatLng) => `${p.lat.toFixed(COORD_DECIMALS)},${p.lng.toFixed(COORD_DECIMALS)}`
/** セッション内キャッシュ（約 11m 単位で丸めたキー） */
const elevationCache = new Map<string, number>()

export function clearElevationCache(): void {
  elevationCache.clear()
}

interface OpenMeteoElevationResponse {
  elevation?: number[]
}

export function buildElevationUrl(points: readonly LatLng[]): string {
  const lat = points.map((p) => p.lat.toFixed(COORD_DECIMALS)).join(',')
  const lng = points.map((p) => p.lng.toFixed(COORD_DECIMALS)).join(',')
  return `${OPEN_METEO_ELEVATION_URL}?latitude=${lat}&longitude=${lng}`
}

export interface ElevationFetchOptions extends RequestOptions {
  /** 並列リクエスト数（既定 2） */
  concurrency?: number
}

/**
 * 任意個の座標の標高を取得。重複除去・キャッシュ済みを除いた点を 100 点ずつにバッチ化。
 * バッチ単位の部分成功: 失敗したバッチの点は null。全点 null なら null を返す。
 * 呼び出し元が abort した場合は AbortError を throw。
 */
export async function fetchElevations(
  points: readonly LatLng[],
  { signal, timeoutMs = 10_000, concurrency = 2 }: ElevationFetchOptions = {},
): Promise<(number | null)[] | null> {
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
  await mapWithConcurrency(batches, concurrency, async (batch) => {
    try {
      const json = await fetchJson<OpenMeteoElevationResponse>(buildElevationUrl(batch), undefined, { signal, timeoutMs })
      const elev = json.elevation
      if (!Array.isArray(elev) || elev.length !== batch.length) throw new Error('Unexpected elevation response')
      batch.forEach((p, i) => {
        if (typeof elev[i] === 'number' && Number.isFinite(elev[i])) elevationCache.set(pointKey(p), elev[i])
      })
    } catch (e) {
      if (signal?.aborted) throw e
      if (!isAbortError(e)) console.warn('[elevation] batch failed', e)
    }
  })
  const out = keys.map((k) => elevationCache.get(k) ?? null)
  return out.every((v) => v === null) && out.length > 0 ? null : out
}

/**
 * 一覧用: 出発地から各候補までを直線補間でサンプリングし、まとめてバッチ取得して標高サマリを返す。
 * 有効サンプルが 2 点未満の候補は null。
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
    const slice = elevations?.slice(i * samplesPerRoute, (i + 1) * samplesPerRoute) ?? []
    const valid = slice.filter((v) => v !== null).length
    result.set(d.id, valid >= 2 ? summarizeElevation(slice, haversineKm(origin, d), summarize) : null)
  })
  return result
}

/** 経路サンプル数: 約 100m 間隔、10〜100 点（1 リクエストに収める） */
export function routeSampleCount(distanceKm: number): number {
  return Math.max(10, Math.min(OPEN_METEO_MAX_POINTS, Math.round(distanceKm * 10) + 1))
}

/**
 * 詳細用: 等間隔サンプリング済みの経路形状を受け取り、標高サマリを返す。失敗時 null。
 */
export async function fetchRouteElevationSummary(
  sampledPath: readonly LatLng[],
  distanceKm: number,
  opts: ElevationFetchOptions & { summarize?: SummarizeOptions } = {},
): Promise<ElevationSummary | null> {
  const { summarize, ...rest } = opts
  const elevations = await fetchElevations(sampledPath, rest)
  if (!elevations || elevations.filter((v) => v !== null).length < 2) return null
  return summarizeElevation(elevations, distanceKm, { estimated: false, ...summarize })
}
