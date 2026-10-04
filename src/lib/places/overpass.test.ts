import { describe, expect, it } from 'vitest'
import { hangingFetch, jsonResponse, mockFetch } from '../../test/fetchMock'
import { destinationPoint } from '../geo'
import { buildOverpassQuery, categorizeOsmTags, createOverpassProvider, parseOverpassElements, type OverpassElement } from './overpass'

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

describe('buildOverpassQuery', () => {
  it('uses a donut (outer around minus inner around) per selector', () => {
    const q = buildOverpassQuery(C, 2, 3.5)
    expect(q).toMatch(/^\[out:json\]\[timeout:\d+\];/)
    expect(q).toContain('(around:3500,35.681236,139.767125)')
    expect(q).toContain('(around:2000,35.681236,139.767125)')
    expect(q).toContain('"tourism"="viewpoint"')
    expect(q).toContain('"amenity"="cafe"')
    expect(q).toContain('"shop"="bakery"')
    expect(q).toContain('"amenity"="place_of_worship"')
    expect(q).toContain('"historic"')
    expect(q).toContain('"tourism"="attraction"')
    expect(q).toContain('道の駅')
    expect(q).not.toContain('riverbank')
    expect(q).toMatch(/out body bb \d+;/)
  })
  it('omits the difference when minKm is 0', () => {
    expect(buildOverpassQuery(C, 0, 1)).not.toContain(' - ')
  })
})

describe('categorizeOsmTags', () => {
  it.each([
    [{ leisure: 'park', name: '代々木公園' }, 'park'],
    [{ leisure: 'park', name: '荒川河川敷公園' }, 'waterside'],
    [{ tourism: 'viewpoint' }, 'viewpoint'],
    [{ amenity: 'cafe' }, 'cafe'],
    [{ shop: 'bakery' }, 'bakery'],
    [{ amenity: 'place_of_worship', religion: 'shinto' }, 'shrine'],
    [{ historic: 'castle' }, 'historic'],
    [{ natural: 'beach' }, 'waterside'],
    [{ tourism: 'attraction' }, 'attraction'],
    [{ highway: 'services', name: '道の駅 八王子滝山' }, 'roadside_station'],
    [{ shop: 'convenience' }, 'other'],
  ] as const)('%o → %s', (tags, expected) => {
    expect(categorizeOsmTags(tags as Record<string, string>)).toBe(expected)
  })
})

describe('parseOverpassElements', () => {
  it('keeps named elements, computes distance/bearing, preserves photo tags, drops small parks', () => {
    const els: OverpassElement[] = [
      node(1, 90, 3, { amenity: 'cafe', name: '東珈琲', wikidata: 'Q123', image: 'https://e.test/a.jpg', foo: 'bar' }),
      node(2, 90, 3, { amenity: 'cafe' }), // unnamed
      way(3, 0, 3, 0.01, { leisure: 'park', name: '北公園', wikimedia_commons: 'File:Park.jpg' }), // ~1.4 km diagonal
      way(4, 0, 3, 0.0005, { leisure: 'park', name: '小さい公園' }), // ~70 m
      node(5, 0, 3, { leisure: 'park', name: 'ノード公園' }),
      way(6, 0, 3, 0.01, { leisure: 'park', name: '第二児童遊園' }),
      node(7, 180, 3, { amenity: 'cafe', name: '私邸カフェ', access: 'private' }),
    ]
    const ps = parseOverpassElements(els, C)
    expect(ps.map((p) => p.id)).toEqual(['osm:node/1', 'osm:way/3'])
    const cafe = ps[0]
    expect(cafe.distanceKm).toBeCloseTo(3, 3)
    expect(cafe.bearing).toBeCloseTo(90, 0)
    expect(cafe.tags).toEqual({ name: '東珈琲', wikidata: 'Q123', image: 'https://e.test/a.jpg', amenity: 'cafe' })
    expect(cafe.source).toBe('overpass')
    expect(ps[1].tags?.wikimedia_commons).toBe('File:Park.jpg')
  })
})

describe('createOverpassProvider', () => {
  const elements = [
    node(1, 10, 3, { amenity: 'cafe', name: 'カフェA' }),
    node(2, 100, 3, { tourism: 'viewpoint', name: '展望台B' }),
    node(3, 200, 1, { amenity: 'cafe', name: '近すぎカフェ' }), // inside donut hole
    node(4, 300, 3, { amenity: 'cafe', name: 'カフェA' }), // duplicate name
  ]

  it('POSTs form-encoded query and returns donut-filtered, deduped places', async () => {
    const f = mockFetch(() => jsonResponse({ elements }))
    const p = createOverpassProvider({ endpoints: ['https://a.test/api'] })
    const res = await p.search(C, 2, 4)
    expect(res.map((x) => x.name).sort()).toEqual(['カフェA', '展望台B'])
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://a.test/api')
    expect(init?.method).toBe('POST')
    expect(String(init?.body)).toMatch(/^data=/)
  })

  it('falls back to the next endpoint on failure', async () => {
    const f = mockFetch((url) => (url.startsWith('https://a.test') ? jsonResponse({}, 504) : jsonResponse({ elements })))
    const p = createOverpassProvider({ endpoints: ['https://a.test/api', 'https://b.test/api'] })
    expect(await p.search(C, 2, 4)).toHaveLength(2)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('throws when all endpoints fail', async () => {
    mockFetch(() => jsonResponse({}, 429))
    const p = createOverpassProvider({ endpoints: ['https://a.test/api', 'https://b.test/api'] })
    await expect(p.search(C, 2, 4)).rejects.toThrow(/429/)
  })

  it('does not try other endpoints after caller abort', async () => {
    const f = mockFetch(hangingFetch)
    const ac = new AbortController()
    const p = createOverpassProvider({ endpoints: ['https://a.test/api', 'https://b.test/api'] })
    const pr = p.search(C, 2, 4, ac.signal)
    ac.abort()
    await expect(pr).rejects.toMatchObject({ name: 'AbortError' })
    expect(f).toHaveBeenCalledTimes(1)
  })
})
