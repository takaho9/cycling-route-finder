import { describe, expect, it } from 'vitest'
import { hangingFetch, jsonResponse, mockFetch } from '../../test/fetchMock'
import { destinationPoint } from '../geo'
import { TimeoutError } from '../http'
import {
  bboxAround,
  buildOverpassQuery,
  HISTORIC_WHITELIST,
  OVERPASS_BUDGET_MS,
  OVERPASS_FIRST_TIMEOUT_MS,
  OVERPASS_SERVER_TIMEOUT_S,
  categorizeOsmTags,
  checkOverpassRemark,
  createOverpassProvider,
  hedgeEndpoints,
  OverpassRemarkError,
  parseOverpassElements,
  type OverpassElement,
} from './overpass'

const C = { lat: 35.681236, lng: 139.767125 }

function node(id: number, bearing: number, km: number, tags: Record<string, string>): OverpassElement {
  const p = destinationPoint(C, bearing, km)
  return { type: 'node', id, lat: p.lat, lon: p.lng, tags }
}
function way(id: number, bearing: number, km: number, sizeDeg: number, tags: Record<string, string>): OverpassElement {
  const p = destinationPoint(C, bearing, km)
  return {
    type: 'way',
    id,
    bounds: { minlat: p.lat - sizeDeg / 2, maxlat: p.lat + sizeDeg / 2, minlon: p.lng - sizeDeg / 2, maxlon: p.lng + sizeDeg / 2 },
    tags,
  }
}

describe('buildOverpassQuery (C1: global bbox, no around)', () => {
  const q = buildOverpassQuery(C, 12)
  it('uses a global [bbox:s,w,n,e] and [timeout:25]; no per-selector around filters', () => {
    const b = bboxAround(C, 12)
    expect(q.split('\n')[0]).toBe(`[out:json][timeout:25][bbox:${b.s},${b.w},${b.n},${b.e}];`)
    expect(OVERPASS_SERVER_TIMEOUT_S).toBe(25)
    expect(q).not.toContain('around:')
    // 12km: 緯度 ±0.1078°, 経度 ±0.1325°（北緯35.68°）
    expect(b.s).toBeCloseTo(35.5734, 3)
    expect(b.n).toBeCloseTo(35.7891, 3)
    expect(b.w).toBeCloseTo(139.6346, 3)
    expect(b.e).toBeCloseTo(139.8997, 3)
  })
  it('is one query with nodes `out body`, parks `out tags bb`, other areas `out tags center`, no server-side limits', () => {
    expect(q).toContain('.n out body;')
    expect(q).toContain('.p out tags bb;')
    expect(q).toContain('.a out tags center;')
    expect(q).not.toMatch(/out [a-z ]+ \d+;/)
    expect(q).not.toContain('riverbank')
    expect(q).toContain('node["amenity"="cafe"]["name"][!"brand"][!"brand:wikidata"];')
  })
  it('includes category selectors and quality filters (Y1)', () => {
    for (const s of ['"tourism"="viewpoint"', '"amenity"="cafe"', '"shop"="bakery"', '"tourism"="attraction"', '道の駅', 'museum', 'ice_cream']) {
      expect(q).toContain(s)
    }
    expect(q).toContain('["religion"~"^(shinto|buddhist)$"]')
    expect(q).toContain('[!"brand"]')
    expect(q).toMatch(/way\["leisure"~"\^\(park\|garden\)\$"\]/)
    expect(q).toMatch(/relation\["amenity"="place_of_worship"\]/)
  })
  it('historic is a value whitelist (memorial etc. are not fetched)', () => {
    expect(q).toContain('node["historic"~"^(castle|ruins|archaeological_site|monument|fort|city_gate|manor)$"]["name"];')
    expect(q).toContain('way["historic"~"^(castle|ruins|archaeological_site|monument|fort|city_gate|manor)$"]["name"];')
    expect(q).not.toMatch(/\["historic"\]\[/) // historic=* の全件取得はしない
    expect(HISTORIC_WHITELIST).not.toContain('memorial')
  })
  it('timeouts: first endpoint 15s, whole budget 20s', () => {
    expect(OVERPASS_FIRST_TIMEOUT_MS).toBe(15_000)
    expect(OVERPASS_BUDGET_MS).toBe(20_000)
  })
})

describe('categorizeOsmTags', () => {
  it.each([
    [{ leisure: 'park', name: '代々木公園' }, 'park'],
    [{ leisure: 'park', name: '荒川河川敷公園' }, 'waterside'],
    [{ leisure: 'park', name: '葛西臨海公園' }, 'seaside'],
    [{ tourism: 'viewpoint' }, 'viewpoint'],
    [{ amenity: 'cafe' }, 'cafe'],
    [{ shop: 'bakery' }, 'bakery'],
    [{ amenity: 'place_of_worship', religion: 'shinto' }, 'shrine'],
    [{ historic: 'castle' }, 'historic'],
    [{ historic: 'ruins' }, 'historic'],
    [{ natural: 'beach' }, 'seaside'],
    [{ natural: 'water', water: 'pond' }, 'waterside'],
    [{ tourism: 'museum' }, 'museum'],
    [{ shop: 'confectionery' }, 'sweets'],
    [{ amenity: 'ice_cream' }, 'sweets'],
    [{ tourism: 'attraction' }, 'attraction'],
    [{ highway: 'services', name: '道の駅 八王子滝山' }, 'roadside_station'],
    [{ shop: 'convenience' }, 'other'],
  ] as const)('%o → %s', (tags, expected) => {
    expect(categorizeOsmTags(tags as Record<string, string>)).toBe(expected)
  })
})

describe('parseOverpassElements', () => {
  it('keeps named & worthwhile elements; ways use center/bounds; keeps photo tags', () => {
    const els: OverpassElement[] = [
      node(1, 90, 3, { amenity: 'cafe', name: '東珈琲', wikidata: 'Q123', image: 'File:A.jpg', foo: 'bar' }),
      node(2, 90, 3, { amenity: 'cafe' }), // unnamed
      way(3, 0, 3, 0.01, { leisure: 'park', name: '北公園', wikimedia_commons: 'File:Park.jpg' }), // ~1.4 km diagonal
      way(4, 0, 3, 0.002, { leisure: 'park', name: '中くらい公園' }), // ~280 m < 400 m
      way(5, 0, 3, 0.002, { leisure: 'park', name: '史跡公園', heritage: '2' }), // small but notable
      node(6, 0, 3, { leisure: 'park', name: 'ノード公園' }),
      way(7, 0, 3, 0.01, { leisure: 'park', name: '第二児童遊園' }),
      node(8, 180, 3, { amenity: 'cafe', name: 'スタバ', brand: 'Starbucks' }),
      node(9, 180, 3, { amenity: 'place_of_worship', name: '教会', religion: 'christian' }),
      { type: 'way', id: 10, center: { lat: 35.7, lon: 139.8 }, tags: { tourism: 'attraction', name: '見どころ' } },
    ]
    const ps = parseOverpassElements(els, C)
    expect(ps.map((p) => p.id)).toEqual(['osm:node/1', 'osm:way/3', 'osm:way/5', 'osm:way/10'])
    expect(ps[0].distanceKm).toBeCloseTo(3, 3)
    expect(ps[0].bearing).toBeCloseTo(90, 0)
    expect(ps[0].tags).toEqual({ name: '東珈琲', wikidata: 'Q123', image: 'File:A.jpg', amenity: 'cafe' })
    expect(Number(ps[1].tags?.size_m)).toBeGreaterThan(1000)
    expect(ps[3]).toMatchObject({ lat: 35.7, lng: 139.8 })
  })
})

describe('parseOverpassElements circle filter (C1)', () => {
  it('drops elements in the bbox corners outside the radius', () => {
    const els = [node(1, 0, 9.5, { amenity: 'cafe', name: '内側' }), node(2, 45, 11, { amenity: 'cafe', name: '四隅' })]
    expect(parseOverpassElements(els, C, 10).map((p) => p.name)).toEqual(['内側'])
    expect(parseOverpassElements(els, C).map((p) => p.name)).toEqual(['内側', '四隅'])
  })
})

describe('remark detection (A1)', () => {
  it('HTTP 200 with a runtime error remark is an error, not 0 results', () => {
    expect(() => checkOverpassRemark({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3 after 12 seconds.' })).toThrow(
      OverpassRemarkError,
    )
    expect(() => checkOverpassRemark({ elements: [] })).not.toThrow()
  })
})

describe('hedgeEndpoints', () => {
  it('starts the next endpoint after the hedge delay and takes the first success', async () => {
    const started: string[] = []
    const r = await hedgeEndpoints(
      ['a', 'b'],
      (ep, signal) => {
        started.push(ep)
        return ep === 'a' ? new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error(), { name: 'AbortError' })))) : Promise.resolve('B')
      },
      { budgetMs: 1000, hedgeDelayMs: 20 },
    )
    expect(r).toBe('B')
    expect(started).toEqual(['a', 'b'])
  })
  it('rejects with TimeoutError when the budget runs out', async () => {
    const p = hedgeEndpoints(['a'], (_ep, signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error(), { name: 'AbortError' })))), {
      budgetMs: 30,
      hedgeDelayMs: 1000,
    })
    await expect(p).rejects.toBeInstanceOf(TimeoutError)
  })
})

describe('createOverpassProvider', () => {
  const elements = [node(1, 10, 3, { amenity: 'cafe', name: 'カフェA' }), node(2, 100, 3, { tourism: 'viewpoint', name: '展望台B' })]
  const opts = { budgetMs: 2000, hedgeDelayMs: 1000 }

  it('POSTs a form-encoded query and returns all parsed places (filtering is client-side)', async () => {
    const f = mockFetch(() => jsonResponse({ elements }))
    const res = await createOverpassProvider({ endpoints: ['https://a.test/api'], ...opts }).search(C, 1, 12)
    expect(res.map((x) => x.name).sort()).toEqual(['カフェA', '展望台B'])
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://a.test/api')
    expect(init?.method).toBe('POST')
    expect(String(init?.body)).toMatch(/^data=/)
  })

  it('falls back to the next endpoint on 429 without Retry-After (no immediate retry of the same endpoint)', async () => {
    const f = mockFetch((url) => (url.startsWith('https://a.test') ? jsonResponse({}, 429) : jsonResponse({ elements })))
    expect(await createOverpassProvider({ endpoints: ['https://a.test/api', 'https://b.test/api'], ...opts }).search(C, 1, 12)).toHaveLength(2)
    expect(f.mock.calls.map(([u]) => String(u))).toEqual(['https://a.test/api', 'https://b.test/api'])
  })

  it('does not wait for Retry-After: 429 with Retry-After moves to the next endpoint immediately (C12)', async () => {
    const f = mockFetch((url) =>
      url.startsWith('https://a.test') ? new Response('{}', { status: 429, headers: { 'Retry-After': '2' } }) : jsonResponse({ elements }),
    )
    const t0 = Date.now()
    expect(await createOverpassProvider({ endpoints: ['https://a.test/api', 'https://b.test/api'], ...opts }).search(C, 1, 12)).toHaveLength(2)
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(f.mock.calls.map(([u]) => String(u))).toEqual(['https://a.test/api', 'https://b.test/api'])
  })

  it('a TypeError (e.g. 429 without CORS headers) moves on to the next endpoint (C12)', async () => {
    const f = mockFetch((url) => (url.startsWith('https://a.test') ? Promise.reject(new TypeError('Failed to fetch')) : jsonResponse({ elements })))
    expect(await createOverpassProvider({ endpoints: ['https://a.test/api', 'https://b.test/api'], ...opts }).search(C, 1, 12)).toHaveLength(2)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('sends the bbox query and filters the circle client-side', async () => {
    const far = node(3, 45, 11.9, { amenity: 'cafe', name: '四隅カフェ' })
    const f = mockFetch(() => jsonResponse({ elements: [...elements, far] }))
    const res = await createOverpassProvider({ endpoints: ['https://a.test/api'], ...opts }).search(C, 1, 10)
    expect(res.map((x) => x.name).sort()).toEqual(['カフェA', '展望台B'])
    const sent = new URLSearchParams(String(f.mock.calls[0][1]?.body)).get('data')!
    expect(sent).toContain('[bbox:')
    expect(sent).not.toContain('around:')
  })

  it('treats a remark runtime error as a failure and moves on', async () => {
    mockFetch((url) => (url.startsWith('https://a.test') ? jsonResponse({ elements: [], remark: 'runtime error: out of memory' }) : jsonResponse({ elements })))
    expect(await createOverpassProvider({ endpoints: ['https://a.test/api', 'https://b.test/api'], ...opts }).search(C, 1, 12)).toHaveLength(2)
  })

  it('throws when all endpoints fail', async () => {
    mockFetch(() => jsonResponse({}, 504))
    await expect(createOverpassProvider({ endpoints: ['https://a.test/api', 'https://b.test/api'], ...opts }).search(C, 1, 12)).rejects.toThrow(/504/)
  })

  it('caller abort stops everything', async () => {
    const f = mockFetch(hangingFetch)
    const ac = new AbortController()
    const pr = createOverpassProvider({ endpoints: ['https://a.test/api', 'https://b.test/api'], ...opts }).search(C, 1, 12, ac.signal)
    ac.abort()
    await expect(pr).rejects.toMatchObject({ name: 'AbortError' })
    expect(f).toHaveBeenCalledTimes(1)
  })
})
