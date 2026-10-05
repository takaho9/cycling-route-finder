import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { jsonResponse, mockFetch } from '../test/fetchMock'
import { clearElevationCache, ELEVATION_PERSIST_TTL_MS, fetchElevations, setElevationPersistentCache } from './elevation'
import { createIndexedDbKvBackend, createKvCache, type KvCache, type KvCacheOptions } from './kvCache'
import { clearPhotoCache, PHOTO_NONE_PERSIST_TTL_MS, PHOTO_PERSIST_TTL_MS, resolvePhotos, setPhotoPersistentCache, type PhotoInfo } from './photos'
import { clearRouteCache, fetchRoute, ROUTE_PERSIST_TTL_MS, setRoutePersistentCache, type RouteResult } from './routing'

/**
 * v1.2: 標高・写真・ルートの永続キャッシュ（メモリ → 永続 → ネットワーク）。
 * 「アプリを開き直す」= メモリ層を消す。永続層は fake-indexeddb。
 */
const DAY = 24 * 60 * 60 * 1000
let t = 0
let pending: Promise<void>[] = []

/** 書き込みは fire-and-forget なので、テストでは完了を待てるようにする */
function tracked<T>(opts: Omit<KvCacheOptions<T>, 'backend' | 'now'>, idb: IDBFactory): KvCache<T> {
  const c = createKvCache<T>({ ...opts, backend: createIndexedDbKvBackend(idb), now: () => t })
  return {
    ...c,
    setMany: (e) => {
      const p = c.setMany(e)
      pending.push(p)
      return p
    },
  }
}
const flush = async () => {
  await Promise.all(pending)
  pending = []
}
/** アプリを開き直す: メモリ層だけ消える */
const restart = () => {
  clearElevationCache()
  clearPhotoCache()
  clearRouteCache()
}

beforeEach(() => {
  t = 1_000_000
  pending = []
  const idb = new IDBFactory()
  setElevationPersistentCache(tracked<number>({ namespace: 'elevation', ttlMs: ELEVATION_PERSIST_TTL_MS, maxEntries: 20_000 }, idb))
  setPhotoPersistentCache(
    tracked<PhotoInfo | null>(
      { namespace: 'photo', ttlMs: PHOTO_PERSIST_TTL_MS, ttlFor: (v) => (v ? PHOTO_PERSIST_TTL_MS : PHOTO_NONE_PERSIST_TTL_MS), maxEntries: 2000 },
      idb,
    ),
  )
  setRoutePersistentCache(tracked<RouteResult>({ namespace: 'route', ttlMs: ROUTE_PERSIST_TTL_MS, maxEntries: 100 }, idb))
  restart()
})
afterEach(() => {
  setElevationPersistentCache(undefined)
  setPhotoPersistentCache(undefined)
  setRoutePersistentCache(undefined)
})

describe('elevation: persistent layer', () => {
  const pts = Array.from({ length: 30 }, (_, i) => ({ lat: 35.68 + i * 0.001, lng: 139.76 }))
  const openMeteo = () =>
    mockFetch((url) => {
      const n = new URL(url).searchParams.get('latitude')!.split(',').length
      return jsonResponse({ elevation: Array.from({ length: n }, (_, i) => 10 + i) })
    })

  it('TTL is 30 days', () => expect(ELEVATION_PERSIST_TTL_MS).toBe(30 * DAY))

  it('a persistent hit does not call fetch after a restart', async () => {
    const f = openMeteo()
    const first = await fetchElevations(pts)
    expect(f).toHaveBeenCalledTimes(1)
    await flush()
    restart()
    const second = await fetchElevations(pts)
    expect(second).toEqual(first)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('only the points missing from the persistent layer go to the network', async () => {
    const f = openMeteo()
    await fetchElevations(pts.slice(0, 20))
    await flush()
    restart()
    await fetchElevations(pts)
    expect(f).toHaveBeenCalledTimes(2)
    expect(new URL(String(f.mock.calls[1][0])).searchParams.get('latitude')!.split(',')).toHaveLength(10)
  })

  it('refetches after the TTL', async () => {
    const f = openMeteo()
    await fetchElevations(pts)
    await flush()
    restart()
    t += 30 * DAY + 1
    await fetchElevations(pts)
    expect(f).toHaveBeenCalledTimes(2)
  })
})

describe('photos: persistent layer', () => {
  const base = { lat: 35.68, lng: 139.76 }
  const withPhoto = { id: 'a', ...base, tags: { wikimedia_commons: 'File:Tag_photo.jpg' } }
  const noPhoto = { id: 'b', ...base, category: 'cafe' as const, tags: { wikidata: 'Q1' } }
  const commons = () =>
    mockFetch((url) => {
      const u = new URL(url)
      if (u.host === 'query.wikidata.org') return jsonResponse({ results: { bindings: [] } }) // P18 なし
      const titles = u.searchParams.get('titles')!.split('|')
      return jsonResponse({
        query: {
          pages: Object.fromEntries(
            titles.map((title, i) => [String(-i - 1), { title, imageinfo: [{ thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/T.jpg/500px-T.jpg' }] }]),
          ),
        },
      })
    })

  it('TTLs: 30 days, "no photo" 3 days', () => {
    expect(PHOTO_PERSIST_TTL_MS).toBe(30 * DAY)
    expect(PHOTO_NONE_PERSIST_TTL_MS).toBe(3 * DAY)
  })

  it('a persistent hit (photo and "no photo") does not call fetch after a restart', async () => {
    const f = commons()
    const first = await resolvePhotos([withPhoto, noPhoto])
    expect(first.get('a')?.url).toMatch(/upload\.wikimedia\.org/)
    expect(first.get('b')).toBeNull()
    const calls = f.mock.calls.length
    await flush()
    restart()
    const second = await resolvePhotos([withPhoto, noPhoto])
    expect(second).toEqual(first)
    expect(f).toHaveBeenCalledTimes(calls)
  })

  it('"no photo" expires after 3 days, a photo is kept until 30 days', async () => {
    const f = commons()
    await resolvePhotos([withPhoto, noPhoto])
    await flush()
    restart()
    t += 3 * DAY + 1
    f.mockClear()
    await resolvePhotos([withPhoto, noPhoto])
    // b だけ取り直す（wikidata のみ。a の Commons は呼ばない）
    expect(f.mock.calls.map(([u]) => new URL(String(u)).host)).toEqual(['query.wikidata.org'])
    await flush()
    restart()
    t += 27 * DAY
    f.mockClear()
    await resolvePhotos([withPhoto])
    expect(f.mock.calls.map(([u]) => new URL(String(u)).host)).toEqual(['commons.wikimedia.org'])
  })

  it('a network failure is not persisted as "no photo"', async () => {
    const f = mockFetch(() => jsonResponse({}, 500))
    expect((await resolvePhotos([noPhoto])).get('b')).toBeNull()
    await flush()
    restart()
    const before = f.mock.calls.length
    await resolvePhotos([noPhoto])
    expect(f.mock.calls.length).toBeGreaterThan(before)
  })

  it('keys include the width (list 500 / detail 960)', async () => {
    const f = commons()
    await resolvePhotos([withPhoto], { width: 500 })
    await flush()
    restart()
    await resolvePhotos([withPhoto], { width: 960 })
    expect(f).toHaveBeenCalledTimes(2)
  })
})

describe('routes: persistent layer', () => {
  const A = { lat: 35.681236, lng: 139.767125 }
  const B = { lat: 35.690921, lng: 139.700258 }
  const osrm = () =>
    mockFetch(() =>
      jsonResponse({
        code: 'Ok',
        routes: [{ distance: 7400, duration: 1500, geometry: { coordinates: [[139.767125, 35.681236], [139.73, 35.69], [139.700258, 35.690921]] } }],
      }),
    )

  it('TTL is 7 days', () => expect(ROUTE_PERSIST_TTL_MS).toBe(7 * DAY))

  it('a persistent hit does not call fetch after a restart', async () => {
    const f = osrm()
    const first = await fetchRoute(A, B)
    await flush()
    restart()
    expect(await fetchRoute(A, B)).toEqual(first)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('refetches after the TTL', async () => {
    const f = osrm()
    await fetchRoute(A, B)
    await flush()
    restart()
    t += 7 * DAY + 1
    await fetchRoute(A, B)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('a straight-line fallback is not persisted', async () => {
    const f = mockFetch(() => jsonResponse({ code: 'NoRoute' }))
    expect((await fetchRoute(A, B)).source).toBe('straight')
    await flush()
    restart()
    const n = f.mock.calls.length
    await fetchRoute(A, B)
    expect(f.mock.calls.length).toBe(n * 2)
  })
})
