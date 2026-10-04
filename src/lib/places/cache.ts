import type { LatLng } from '../types'
import type { SearchResult } from './index'

/** 位置を丸めるグリッド (度)。0.005° ≈ 緯度方向 550m / 経度方向 450m (北緯35°) */
export const CACHE_GRID_DEG = 0.005
/** キャッシュ有効期間 */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000
/** 保持する最大件数（古いものから捨てる） */
export const CACHE_MAX_ENTRIES = 20
const PREFIX = 'choichari:v1:places:'

/** 同じセルなら同じクエリになるよう中心をグリッドにスナップ */
export function snapToGrid(p: LatLng, grid = CACHE_GRID_DEG): LatLng {
  const snap = (v: number) => Math.round(Math.round(v / grid) * grid * 1e6) / 1e6
  return { lat: snap(p.lat), lng: snap(p.lng) }
}

export function cacheKey(snapped: LatLng, minKm: number, maxKm: number, providers: string): string {
  return `${PREFIX}${providers}|${snapped.lat.toFixed(4)},${snapped.lng.toFixed(4)}|${minKm.toFixed(1)}-${maxKm.toFixed(1)}`
}

interface Entry {
  savedAt: number
  result: SearchResult
}

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readCache(key: string, now = Date.now(), storage: Storage | null = storageOrNull()): SearchResult | null {
  try {
    const raw = storage?.getItem(key)
    if (!raw) return null
    const e = JSON.parse(raw) as Entry
    if (!e || typeof e.savedAt !== 'number' || now - e.savedAt > CACHE_TTL_MS || !Array.isArray(e.result?.places)) {
      storage?.removeItem(key)
      return null
    }
    return { ...e.result, errors: [] }
  } catch {
    return null
  }
}

export function writeCache(key: string, result: SearchResult, now = Date.now(), storage: Storage | null = storageOrNull()): void {
  if (!storage) return
  try {
    const entry: Entry = { savedAt: now, result: { ...result, errors: [] } }
    storage.setItem(key, JSON.stringify(entry))
    pruneCache(now, storage)
  } catch {
    // quota 等は無視（キャッシュは best effort）
  }
}

/** 期限切れと上限超過分を削除 */
export function pruneCache(now = Date.now(), storage: Storage | null = storageOrNull()): void {
  if (!storage) return
  try {
    const entries: { key: string; savedAt: number }[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (!key?.startsWith(PREFIX)) continue
      let savedAt = 0
      try {
        savedAt = (JSON.parse(storage.getItem(key) ?? '') as Entry).savedAt ?? 0
      } catch {
        /* broken entry → savedAt 0 で削除対象 */
      }
      entries.push({ key, savedAt })
    }
    entries.sort((a, b) => b.savedAt - a.savedAt)
    entries.forEach((e, i) => {
      if (i >= CACHE_MAX_ENTRIES || now - e.savedAt > CACHE_TTL_MS) storage.removeItem(e.key)
    })
  } catch {
    /* ignore */
  }
}
