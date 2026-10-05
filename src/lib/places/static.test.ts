import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, mockFetch } from '../../test/fetchMock'
import { HttpError } from '../http'
import { clearPhotoCache, PHOTO_WIDTH_DETAIL, PHOTO_WIDTH_LIST, resolvePhotos, setPhotoPersistentCache } from '../photos'
import type { Place, PlaceProvider } from '../types'
import { createLocalStorageCache } from './cache'
import { clearPlacesCache, fallbackReason, searchPlaces } from './index'
import { createStaticProvider, clearStaticCache, OutOfCoverageError, staticDataBaseUrl } from './static'
import { inCoverage, pointInRings, recordToPlace, tileKey, tilesForCircle, type StaticIndex, type StaticRecord } from './staticData'

const TOKYO_STATION = { lat: 35.6812, lng: 139.7671 }
const OSAKA = { lat: 34.7025, lng: 135.4959 }
const BASE = '/data/tokyo/'

const rec = (i: string, lat: number, lng: number, extra: Partial<StaticRecord> = {}): StaticRecord => ({ i, n: i, y: lat, x: lng, c: 'park', s: 1, ...extra })

/** 23 区の西半分をざっくり覆うリング（テスト用） */
const RING: [number, number][] = [
  [35.6, 139.6],
  [35.6, 139.85],
  [35.8, 139.85],
  [35.8, 139.6],
  [35.6, 139.6],
]
const TILES: Record<string, StaticRecord[]> = {
  '3565_13975': [
    rec('osm:way/1', 35.68, 139.758, {
      s: 9.5,
      w: 12,
      t: { wikidata: 'Q1' },
      p: { m: 'https://upload.wikimedia.org/a/500px-x.jpg', l: 'https://upload.wikimedia.org/a/960px-x.jpg', a: 'Author', c: 'CC BY-SA 4.0', g: 'https://commons.wikimedia.org/wiki/File:x.jpg' },
    }),
    rec('osm:node/2', 35.69, 139.77, { c: 'cafe' }),
  ],
  '3570_13975': [rec('osm:node/3', 35.71, 139.77, { c: 'shrine' })],
  // 東京駅から 30km 以上（半径外）
  '3575_13960': [rec('osm:node/4', 35.79, 139.61)],
}
const INDEX: StaticIndex = {
  v: 1,
  version: 'abc123',
  generatedAt: '2026-10-05T00:00:00.000Z',
  region: 'test',
  grid: 0.05,
  count: 4,
  bytes: 100,
  tiles: Object.fromEntries(Object.entries(TILES).map(([k, v]) => [k, v.length])),
  coverage: { bbox: [35.6, 139.6, 35.8, 139.85], rings: [RING] },
  sources: [{ name: '© OpenStreetMap contributors', license: 'ODbL', url: 'https://www.openstreetmap.org/copyright' }],
}

function serve(index: StaticIndex | null = INDEX, tiles = TILES, overpass?: () => Response) {
  return mockFetch((url) => {
    const u = new URL(url, 'http://localhost')
    if (u.pathname === `${BASE}index.json`) return index ? jsonResponse(index) : new Response('nf', { status: 404 })
    const m = /\/t_(\d+_\d+)\.json$/.exec(u.pathname)
    if (m) return tiles[m[1]] ? jsonResponse({ v: 1, k: m[1], p: tiles[m[1]] }) : new Response('nf', { status: 404 })
    if (/overpass|interpreter/.test(url) && overpass) return overpass()
    throw new TypeError(`unexpected fetch ${url}`)
  })
}
const tileUrls = (fetchFn: ReturnType<typeof serve>) =>
  fetchFn.mock.calls.map((c) => String(c[0])).filter((u) => /\/t_/.test(u)).map((u) => /t_(\d+_\d+)/.exec(u)![1]).sort()

beforeEach(() => {
  clearStaticCache()
  clearPlacesCache()
})

describe('staticData helpers', () => {
  it('tile key is the SW corner × 100 on a 0.05° grid', () => {
    expect(tileKey(TOKYO_STATION)).toBe('3565_13975')
    expect(tileKey({ lat: 35.7, lng: 139.75 })).toBe('3570_13975')
    expect(tileKey({ lat: 35.6999, lng: 139.7499 })).toBe('3565_13970')
  })

  it('tilesForCircle returns only tiles the circle actually touches', () => {
    expect(tilesForCircle(TOKYO_STATION, 1)).toEqual(['3565_13975'])
    const ten = tilesForCircle(TOKYO_STATION, 10)
    expect(ten).toEqual(expect.arrayContaining(['3560_13970', '3565_13975', '3570_13980', '3565_13965']))
    // 四隅のタイルは円にかからない
    expect(ten).not.toContain('3555_13965')
    expect(ten.length).toBeLessThan(25)
  })

  it('coverage: polygon (even-odd) when present, then cells, then bbox', () => {
    expect(pointInRings(TOKYO_STATION, [RING])).toBe(true)
    expect(inCoverage(INDEX, TOKYO_STATION)).toBe(true)
    expect(inCoverage(INDEX, OSAKA)).toBe(false)
    // bbox 内だがリング外
    const notched = { coverage: { bbox: [35.6, 139.6, 35.8, 139.85] as [number, number, number, number], rings: [[[35.6, 139.6], [35.6, 139.7], [35.8, 139.7], [35.8, 139.6], [35.6, 139.6]] as [number, number][]] } }
    expect(inCoverage(notched, TOKYO_STATION)).toBe(false)
    expect(inCoverage({ coverage: { bbox: [35, 139, 36, 140], cells: ['3565_13975'] } }, TOKYO_STATION)).toBe(true)
    expect(inCoverage({ coverage: { bbox: [35, 139, 36, 140], cells: ['3570_13975'] } }, TOKYO_STATION)).toBe(false)
  })

  it('recordToPlace expands the short form (source static, score, embedded photo with credit)', () => {
    const p = recordToPlace(TILES['3565_13975'][0], TOKYO_STATION)
    expect(p).toMatchObject({
      id: 'osm:way/1',
      source: 'static',
      score: 9.5,
      category: 'park',
      tags: { wikidata: 'Q1', name: 'osm:way/1', sitelinks: '12' },
      photoEmbed: { url500: expect.stringContaining('500px'), url960: expect.stringContaining('960px'), artist: 'Author', license: 'CC BY-SA 4.0' },
    })
    expect(p.distanceKm).toBeGreaterThan(0.5)
  })
})

describe('createStaticProvider', () => {
  it('base URL follows import.meta.env.BASE_URL', () => {
    expect(staticDataBaseUrl()).toBe('/data/tokyo/')
  })

  it('inside coverage: fetches index once and only the non-empty tiles the radius covers', async () => {
    const f = serve()
    const p = createStaticProvider({ baseUrl: BASE })
    const places = await p.search(TOKYO_STATION, 0, 12)
    expect(places.map((x) => x.id).sort()).toEqual(['osm:node/2', 'osm:node/3', 'osm:way/1'])
    expect(places.every((x) => x.source === 'static')).toBe(true)
    expect(tileUrls(f)).toEqual(['3565_13975', '3570_13975'])
    // タイルには ?v=<version> を付ける（データ更新時に SW の古いタイルを使わない）
    expect(f.mock.calls.some((c) => String(c[0]).endsWith('t_3565_13975.json?v=abc123'))).toBe(true)
    // 2 回目はメモリから（ネットワークに出ない）
    await p.search(TOKYO_STATION, 0, 12)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('drops places beyond the radius even if their tile was fetched', async () => {
    serve()
    // way/1 は約 0.85km、node/2 は約 1.0km（同じタイル）
    const places = await createStaticProvider({ baseUrl: BASE }).search(TOKYO_STATION, 0, 0.9)
    expect(places.map((x) => x.id)).toEqual(['osm:way/1'])
  })

  it('outside coverage → OutOfCoverageError without fetching tiles', async () => {
    const f = serve()
    await expect(createStaticProvider({ baseUrl: BASE }).search(OSAKA, 0, 12)).rejects.toBeInstanceOf(OutOfCoverageError)
    expect(tileUrls(f)).toEqual([])
  })

  it('index or tile failures throw (so the caller falls back to Overpass)', async () => {
    serve(null)
    await expect(createStaticProvider({ baseUrl: BASE }).search(TOKYO_STATION, 0, 12)).rejects.toBeInstanceOf(HttpError)
    clearStaticCache()
    serve(INDEX, { '3565_13975': TILES['3565_13975'] }) // 3570_13975 が 404
    await expect(createStaticProvider({ baseUrl: BASE }).search(TOKYO_STATION, 0, 12)).rejects.toBeInstanceOf(HttpError)
  })

  it('a malformed index.json is a failure, not an empty result', async () => {
    mockFetch(() => jsonResponse({ hello: 'world' }))
    await expect(createStaticProvider({ baseUrl: BASE }).search(TOKYO_STATION, 0, 12)).rejects.toThrow(/Invalid static index/)
  })
})

describe('provider order static → overpass → mock (searchPlaces)', () => {
  const place = (id: string): Place => ({ id, name: id, lat: 34.71, lng: 135.5, category: 'park', distanceKm: 1, bearing: 0, source: 'overpass' })
  const overpass = (impl: () => Promise<Place[]>): PlaceProvider & { search: ReturnType<typeof vi.fn> } => ({ name: 'overpass', search: vi.fn(impl) })
  const mock = (): PlaceProvider & { search: ReturnType<typeof vi.fn> } => ({ name: 'mock', search: vi.fn(async () => [place('m1')]) })
  const cache = () => createLocalStorageCache(localStorage)

  it('Tokyo: static wins, overpass is never called, nothing is persisted', async () => {
    serve()
    const o = overpass(async () => [place('o1')])
    const c = cache()
    const put = vi.spyOn(c, 'put')
    const r = await searchPlaces(TOKYO_STATION, { providers: [createStaticProvider({ baseUrl: BASE }), o, mock()], cache: c })
    expect(r).toMatchObject({ kind: 'ok', source: 'static', isDemo: false })
    expect(r.sample).toBeUndefined()
    expect(o.search).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled() // static は SW が持つので永続キャッシュ不要
  })

  it('Osaka: out of coverage → overpass; the out-of-coverage is not a "fallback reason"', async () => {
    const f = serve()
    const o = overpass(async () => [place('o1')])
    const c = cache()
    const r = await searchPlaces(OSAKA, { providers: [createStaticProvider({ baseUrl: BASE }), o, mock()], cache: c })
    expect(r).toMatchObject({ kind: 'ok', source: 'overpass', isDemo: false })
    expect(r.errors.map((e) => e.error)).toEqual([expect.any(OutOfCoverageError)])
    expect(fallbackReason(r.errors)).toBeNull()
    expect(tileUrls(f)).toEqual([])
    // overpass の結果はプロバイダ名入りのキーで永続化 → 次回はキャッシュから
    clearPlacesCache()
    const again = await searchPlaces(OSAKA, { providers: [createStaticProvider({ baseUrl: BASE }), o, mock()], cache: c })
    expect(again).toMatchObject({ source: 'overpass', fromCache: true })
    expect(o.search).toHaveBeenCalledTimes(1)
    expect(Object.keys(localStorage).some((k) => k.includes(':overpass|34.700,135.500|'))).toBe(true)
    expect(Object.keys(localStorage).some((k) => k.includes('static'))).toBe(false)
  })

  it('static fetch failure → overpass; once static recovers, the cached overpass result does not shadow it', async () => {
    serve(null)
    const o = overpass(async () => [place('o1')])
    const c = cache()
    const providers = () => [createStaticProvider({ baseUrl: BASE }), o, mock()]
    const r1 = await searchPlaces(TOKYO_STATION, { providers: providers(), cache: c })
    expect(r1.source).toBe('overpass')
    clearStaticCache()
    clearPlacesCache()
    serve()
    const r2 = await searchPlaces(TOKYO_STATION, { providers: providers(), cache: c })
    expect(r2.source).toBe('static')
  })

  it('inside coverage with truly nothing around → "empty" (no overpass)', async () => {
    serve({ ...INDEX, tiles: {} }, {})
    const o = overpass(async () => [place('o1')])
    const r = await searchPlaces(TOKYO_STATION, { providers: [createStaticProvider({ baseUrl: BASE }), o, mock()], cache: cache() })
    expect(r).toMatchObject({ kind: 'empty', source: 'static', places: [] })
    expect(o.search).not.toHaveBeenCalled()
  })

  it('sample data is flagged on the result (UI shows it as demo)', async () => {
    serve({ ...INDEX, sample: true })
    const r = await searchPlaces(TOKYO_STATION, { providers: [createStaticProvider({ baseUrl: BASE }), overpass(async () => []), mock()], cache: cache() })
    expect(r).toMatchObject({ kind: 'ok', source: 'static', sample: true, isDemo: false })
  })

  it('all real providers fail → mock demo; reason comes from overpass, not the coverage miss', async () => {
    serve()
    const o = overpass(async () => {
      throw new HttpError(429, 'x')
    })
    const m = mock()
    const r = await searchPlaces(OSAKA, { providers: [createStaticProvider({ baseUrl: BASE }), o, m], cache: cache() })
    expect(r).toMatchObject({ kind: 'demo', source: 'mock', isDemo: true })
    expect(r.errors.map((e) => e.provider)).toEqual(['static', 'overpass'])
    expect(fallbackReason(r.errors)).toBe('busy')
  })
})

describe('embedded photos skip runtime lookups', () => {
  it('uses the embedded 500/960 URLs and credit without any network access', async () => {
    setPhotoPersistentCache(null)
    clearPhotoCache()
    const f = mockFetch(() => {
      throw new Error('no network expected')
    })
    const p = recordToPlace(TILES['3565_13975'][0], TOKYO_STATION)
    const list = await resolvePhotos([p], { width: PHOTO_WIDTH_LIST })
    expect(list.get(p.id)).toEqual({
      url: 'https://upload.wikimedia.org/a/500px-x.jpg',
      artist: 'Author',
      license: 'CC BY-SA 4.0',
      pageUrl: 'https://commons.wikimedia.org/wiki/File:x.jpg',
    })
    const detail = await resolvePhotos([p], { width: PHOTO_WIDTH_DETAIL })
    expect(detail.get(p.id)?.url).toBe('https://upload.wikimedia.org/a/960px-x.jpg')
    expect(f).not.toHaveBeenCalled()
    setPhotoPersistentCache(undefined)
  })
})
