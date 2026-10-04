import type { LatLng, Place, PlaceProvider, PlaceSource } from '../types'
import { createGoogleProvider } from './google'
import { createMockProvider } from './mock'
import { createOverpassProvider } from './overpass'

export { createGoogleProvider } from './google'
export { createMockProvider, generateMockPlaces, mockTerrainElevation } from './mock'
export { createOverpassProvider } from './overpass'
export { balancedSample, dedupeByName, filterDonut, MAX_CANDIDATES } from './sampling'

export interface SearchResult {
  places: Place[]
  source: PlaceSource
  /** true ならデモデータ（UI で小さく表示する） */
  isDemo: boolean
  /** フォールバックに至った各プロバイダの失敗 */
  errors: { provider: PlaceSource; error: unknown }[]
}

/** Google(キー有) → Overpass → Mock の順のプロバイダ列を作る */
export function createDefaultProviders(googleApiKey: string | undefined = readGoogleKey()): PlaceProvider[] {
  const providers: PlaceProvider[] = []
  if (googleApiKey) providers.push(createGoogleProvider({ apiKey: googleApiKey }))
  providers.push(createOverpassProvider(), createMockProvider())
  return providers
}

function readGoogleKey(): string | undefined {
  try {
    const k = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    return typeof k === 'string' && k.trim() ? k.trim() : undefined
  } catch {
    return undefined
  }
}

const cache = new Map<string, SearchResult>()
export function clearPlacesCache(): void {
  cache.clear()
}

export interface SearchPlacesOptions {
  signal?: AbortSignal
  providers?: PlaceProvider[]
  /** これ未満の件数しか返らなければ次のプロバイダへ（既定 1 = 0 件なら次へ） */
  minResults?: number
  useCache?: boolean
}

/**
 * プロバイダを順に試し、最初に minResults 件以上返したものを採用。
 * 全滅した場合は最後に成功した（件数不足の）結果、それも無ければ例外。
 * 呼び出し元の signal が abort された場合は AbortError を throw。
 */
export async function searchPlaces(
  center: LatLng,
  minKm: number,
  maxKm: number,
  { signal, providers, minResults = 1, useCache = true }: SearchPlacesOptions = {},
): Promise<SearchResult> {
  const list = providers ?? createDefaultProviders()
  const key = `${list.map((p) => p.name).join('>')}|${center.lat.toFixed(3)},${center.lng.toFixed(3)}|${minKm.toFixed(2)}-${maxKm.toFixed(2)}`
  if (useCache) {
    const hit = cache.get(key)
    if (hit) return hit
  }
  const errors: SearchResult['errors'] = []
  let partial: SearchResult | null = null
  for (const provider of list) {
    try {
      const places = (await provider.search(center, minKm, maxKm, signal)).map((p) => ({ ...p, source: provider.name }))
      const result: SearchResult = { places, source: provider.name, isDemo: provider.name === 'mock', errors: [...errors] }
      if (places.length >= minResults) {
        if (useCache) cache.set(key, result)
        return result
      }
      if (!partial || places.length > partial.places.length) partial = result
      errors.push({ provider: provider.name, error: new Error(`too few results (${places.length})`) })
    } catch (e) {
      if (signal?.aborted) throw e
      errors.push({ provider: provider.name, error: e })
    }
  }
  if (partial) return { ...partial, errors }
  throw new AggregateError(errors.map((e) => e.error), 'All place providers failed')
}
