import type { LatLng } from '../types'
import type { SearchResult } from './index'

/**
 * 検索中心を丸めるグリッド (度)。0.01° ≈ 緯度 1.1km / 経度 0.9km（北緯35°）。
 * キャッシュヒット率と、外部に送る位置の粗さ（プライバシー）のため（BACKLOG A2）。
 */
export const CACHE_GRID_DEG = 0.01
/** グリッドへのスナップで動く最大距離 (km) の上限。検索半径にこの分を足す */
export const GRID_MARGIN_KM = 0.8
/** キャッシュ有効期間 7 日（BACKLOG A2） */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** 保持する最大件数（古いものから捨てる） */
export const CACHE_MAX_ENTRIES = 30
const LS_PREFIX = 'choichari:v1:places:'
const DB_NAME = 'choichari'
const STORE = 'places'

/** 同じセルなら同じクエリになるよう中心をグリッドにスナップ */
export function snapToGrid(p: LatLng, grid = CACHE_GRID_DEG): LatLng {
  const snap = (v: number) => Math.round(Math.round(v / grid) * grid * 1e6) / 1e6
  return { lat: snap(p.lat), lng: snap(p.lng) }
}

export function cacheKey(snapped: LatLng, maxKm: number, providers: string): string {
  return `${providers}|${snapped.lat.toFixed(3)},${snapped.lng.toFixed(3)}|${maxKm.toFixed(1)}`
}

export interface CacheEntry {
  key: string
  savedAt: number
  result: SearchResult
}

export interface PlacesCache {
  get(key: string, now?: number): Promise<SearchResult | null>
  put(key: string, result: SearchResult, now?: number): Promise<void>
}

const fresh = (e: CacheEntry | null | undefined, now: number): e is CacheEntry =>
  !!e && typeof e.savedAt === 'number' && now - e.savedAt <= CACHE_TTL_MS && Array.isArray(e.result?.places)

const strip = (r: SearchResult): SearchResult => ({ ...r, errors: [], fromCache: undefined })

// ---------------------------------------------------------------------------
// localStorage 実装（IndexedDB が使えない環境・テスト用）
// ---------------------------------------------------------------------------

export function createLocalStorageCache(storage: Storage | null = safeLocalStorage()): PlacesCache {
  return {
    async get(key, now = Date.now()) {
      try {
        const raw = storage?.getItem(LS_PREFIX + key)
        if (!raw) return null
        const e = JSON.parse(raw) as CacheEntry
        if (fresh(e, now)) return { ...e.result, errors: [] }
        storage?.removeItem(LS_PREFIX + key)
      } catch {
        /* ignore */
      }
      return null
    },
    async put(key, result, now = Date.now()) {
      if (!storage) return
      try {
        storage.setItem(LS_PREFIX + key, JSON.stringify({ key, savedAt: now, result: strip(result) } satisfies CacheEntry))
        const entries: { k: string; savedAt: number }[] = []
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i)
          if (!k?.startsWith(LS_PREFIX)) continue
          let savedAt = 0
          try {
            savedAt = (JSON.parse(storage.getItem(k) ?? '') as CacheEntry).savedAt ?? 0
          } catch {
            /* broken → 削除 */
          }
          entries.push({ k, savedAt })
        }
        entries
          .sort((a, b) => b.savedAt - a.savedAt)
          .forEach((e, i) => {
            if (i >= CACHE_MAX_ENTRIES || now - e.savedAt > CACHE_TTL_MS) storage.removeItem(e.k)
          })
      } catch {
        /* quota 等は無視（best effort） */
      }
    },
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// IndexedDB 実装（既定。数百件の POI でも localStorage の 5MB を圧迫しない）
// ---------------------------------------------------------------------------

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

export function createIndexedDbCache(idb: IDBFactory): PlacesCache {
  let dbp: Promise<IDBDatabase> | null = null
  const open = () =>
    (dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
      const r = idb.open(DB_NAME, 1)
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'key' })
      }
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    }))
  return {
    async get(key, now = Date.now()) {
      try {
        const db = await open()
        const e = (await req(db.transaction(STORE).objectStore(STORE).get(key))) as CacheEntry | undefined
        return fresh(e, now) ? { ...e.result, errors: [] } : null
      } catch {
        return null
      }
    },
    async put(key, result, now = Date.now()) {
      try {
        const db = await open()
        const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
        await req(store.put({ key, savedAt: now, result: strip(result) } satisfies CacheEntry))
        const all = ((await req(db.transaction(STORE).objectStore(STORE).getAll())) as CacheEntry[]).sort((a, b) => b.savedAt - a.savedAt)
        const del = all.filter((e, i) => i >= CACHE_MAX_ENTRIES || now - e.savedAt > CACHE_TTL_MS)
        if (del.length) {
          const s = db.transaction(STORE, 'readwrite').objectStore(STORE)
          await Promise.all(del.map((e) => req(s.delete(e.key))))
        }
      } catch {
        /* best effort */
      }
    },
  }
}

/** IndexedDB があればそれ、無ければ localStorage */
export function createDefaultPlacesCache(): PlacesCache {
  try {
    if (typeof indexedDB !== 'undefined' && indexedDB) return createIndexedDbCache(indexedDB)
  } catch {
    /* fallthrough */
  }
  return createLocalStorageCache()
}
