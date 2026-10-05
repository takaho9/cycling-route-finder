// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { PhotoInfo } from '../../src/lib/photos'
import { acquire, type AcquireDeps } from './acquire'
import { municipalityLookup, type GeomWay } from './boundary'
import { appealScore, mergeSources, type PoiDraft } from './merge'
import { applyNaming } from './naming'
import { municipalitiesFromOpl } from './osm-pbf'
import { attachPhotos } from './photos'
import { applyQualityRules, dropWeakForeignNames, mergeNearSimilar } from './quality'
import { buildQidDetailsSparql, parseQidDetails, type WikidataItem } from './wikidata'

const d = (id: string, name: string, category: PoiDraft['category'], extra: Partial<PoiDraft> = {}): PoiDraft => ({
  id,
  name,
  lat: 35.7,
  lng: 139.7,
  category,
  tags: {},
  ...extra,
})

describe('Q1 naming', () => {
  const city = () => '江東区'
  it('generic / sub-building / English names take the Wikidata ja label', () => {
    const { pois, stats } = applyNaming([
      d('osm:way/1', '本殿', 'shrine', { tags: { wikidata: 'Q1' }, wdLabel: '明治神宮' }),
      d('osm:node/2', 'Tokyo Tower', 'attraction', { tags: { wikidata: 'Q2' }, wdLabel: '東京タワー' }),
      d('osm:node/3', '展望台', 'viewpoint', { tags: { wikidata: 'Q3' }, wdLabel: '高尾山展望台' }),
      d('osm:way/4', '清澄庭園', 'park', { tags: { wikidata: 'Q4' }, wdLabel: '都立清澄庭園' }), // ラベルが元の名前を含み長い
    ])
    expect(pois.map((p) => p.name)).toEqual(['明治神宮', '東京タワー', '高尾山展望台', '都立清澄庭園'])
    expect(stats.byLabel).toBe(4)
  })

  it('generic names without a better label get the municipality; repeated names (3+) too', () => {
    const { pois, stats } = applyNaming(
      [
        d('osm:way/1', '八幡神社', 'shrine', { tags: { wikidata: 'Q1' }, wdLabel: '八幡神社' }),
        d('osm:way/2', '西光寺', 'shrine'),
        d('osm:way/3', '西光寺', 'shrine', { lat: 35.8 }),
        d('osm:way/4', '西光寺', 'shrine', { lat: 35.9 }),
        d('osm:way/5', '深川不動堂', 'shrine', { tags: { wikidata: 'Q5' } }),
        d('osm:node/6', 'カフェ', 'cafe'), // 飲食は対象外
      ],
      { municipalityOf: city },
    )
    expect(pois.map((p) => p.name)).toEqual(['八幡神社（江東区）', '西光寺（江東区）', '西光寺（江東区）', '西光寺（江東区）', '深川不動堂', 'カフェ'])
    expect(stats.byCity).toBe(4)
  })

  it('sub-building names that cannot be replaced are dropped even with wikidata', () => {
    const { pois, stats } = applyNaming([d('osm:way/1', '本殿', 'shrine', { tags: { wikidata: 'Q1' } }), d('osm:way/2', '拝殿', 'shrine', { tags: { wikidata: 'Q2' }, wdLabel: '拝殿' })])
    expect(pois).toEqual([])
    expect(stats.droppedParts).toBe(2)
  })
})

describe('Q4 Wikidata details for all OSM QIDs', () => {
  it('VALUES query without a class filter; parses label / P18 / sitelinks / P1435', () => {
    const q = buildQidDetailsSparql(['Q1', 'Q2'])
    expect(q).toContain('VALUES ?item { wd:Q1 wd:Q2 }')
    expect(q).not.toContain('P31')
    const m = parseQidDetails({
      results: {
        bindings: [
          { item: { value: 'http://www.wikidata.org/entity/Q1' }, label: { value: '明治神宮' }, sitelinks: { value: '40' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Meiji%20Jingu.jpg' } },
          { item: { value: 'http://www.wikidata.org/entity/Q1' }, heritage: { value: 'x' }, sitelinks: { value: '40' } },
        ],
      },
    })
    expect(m.get('Q1')).toEqual({ qid: 'Q1', label: '明治神宮', image: 'File:Meiji Jingu.jpg', sitelinks: 40, heritage: true })
  })

  it('merge applies details to OSM places whose QID is outside the class whitelist', () => {
    const { pois } = mergeSources([d('osm:way/1', '本殿', 'shrine', { tags: { wikidata: 'Q1' } })], [], new Map([['Q1', { qid: 'Q1', label: '明治神宮', image: 'File:A.jpg', sitelinks: 40, heritage: true }]]))
    expect(pois[0]).toMatchObject({ wdLabel: '明治神宮', p18: 'File:A.jpg', sitelinks: 40, wdHeritage: true })
  })

  it('Q12: Wikidata-only bridges need sitelinks >= 4 or heritage', () => {
    const br = (qid: string, sitelinks: number, heritage = false): WikidataItem => ({ qid, label: qid, lat: 35.7, lng: 139.7 + Number(qid.slice(1)) / 100, sitelinks, classQid: 'Q12280', category: 'attraction', heritage })
    const { pois } = mergeSources([], [br('Q1', 3), br('Q2', 4), br('Q3', 1, true)])
    expect(pois.map((p) => p.id)).toEqual(['wd:Q2', 'wd:Q3'])
  })
})

describe('Q2 / Q3 / Q6 / Q9 / Q11 quality', () => {
  it('Q3: not-a-destination names and excluded QIDs (also for Wikidata-only items)', () => {
    const { pois, stats } = applyQualityRules([
      d('osm:node/1', '東中野駅 駅スタンプ', 'attraction'),
      d('osm:way/2', '1号調整池', 'waterside'),
      d('wd:Q49173570', '第六台場', 'historic', { tags: { wikidata: 'Q49173570' } }),
      d('osm:way/3', '赤坂御用地', 'historic', { tags: { wikidata: 'Q11635414' } }),
      d('osm:way/4', '代々木公園', 'park', { tags: { wikidata: 'Q1' } }),
    ])
    expect(pois.map((p) => p.name)).toEqual(['代々木公園'])
    expect(stats.notDestination).toBe(4)
  })

  it('Q11: small monuments (碑/塔/像/墓/台座跡) without wikidata/heritage are dropped', () => {
    const { pois } = applyQualityRules([
      d('osm:node/1', '題目塔', 'historic'),
      d('osm:node/2', '忠犬ハチ公像', 'attraction', { tags: { wikidata: 'Q1' } }),
      d('osm:node/3', '某所の碑', 'historic', { tags: { heritage: '2' } }),
      d('osm:way/4', '平和の塔', 'historic'),
    ])
    expect(pois.map((p) => p.id)).toEqual(['osm:node/2', 'osm:node/3', 'osm:way/4'])
  })

  it('Q2 / Q6: things inside zoos, theme parks and large parks are absorbed; notable ones stay', () => {
    const ext = { minlat: 35.71, minlon: 139.76, maxlat: 35.72, maxlon: 139.78 }
    const { pois, stats } = applyQualityRules([
      d('osm:way/1', '上野動物園', 'attraction', { lat: 35.715, lng: 139.77, tags: { tourism: 'zoo', wikidata: 'Q1' }, extent: ext }),
      d('osm:node/2', 'ハシビロコウ舎', 'attraction', { lat: 35.716, lng: 139.771 }),
      d('osm:way/3', '大きな公園', 'park', { lat: 35.6, lng: 139.6, tags: { leisure: 'park', size_m: '900' }, extent: { minlat: 35.597, minlon: 139.597, maxlat: 35.603, maxlon: 139.603 } }),
      d('osm:way/4', '公園の池', 'waterside', { lat: 35.601, lng: 139.601, extent: { minlat: 35.6005, minlon: 139.6005, maxlat: 35.6015, maxlon: 139.6015 } }),
      d('osm:node/5', '公園内の記念館', 'historic', { lat: 35.599, lng: 139.599, tags: { wikidata: 'Q5' } }),
      d('osm:way/6', '神社', 'shrine', { lat: 35.65, lng: 139.65, extent: { minlat: 35.649, minlon: 139.649, maxlat: 35.651, maxlon: 139.651 } }),
      d('osm:node/7', '神社の資料館', 'museum', { lat: 35.6501, lng: 139.6501 }),
    ])
    expect(pois.map((p) => p.id)).toEqual(['osm:way/1', 'osm:way/3', 'osm:node/5', 'osm:way/6'])
    expect(stats.absorbed).toBe(3)
  })

  it('Q6: within 60m and a similar name → one place even across categories', () => {
    const { pois, merged } = mergeNearSimilar([
      d('osm:way/1', '長谷川町子美術館', 'museum', { score: 9 }),
      d('osm:node/2', '長谷川町子記念館', 'historic', { lat: 35.7003, score: 2 }),
      d('osm:node/3', '代田富士見橋', 'attraction', { lat: 35.75, score: 3 }),
      d('osm:node/4', '代田富士見橋 展望', 'viewpoint', { lat: 35.7502, score: 1 }),
      d('osm:node/5', 'カフェA', 'cafe', { lat: 35.8 }),
      d('osm:node/6', 'パン屋B', 'bakery', { lat: 35.8001 }),
    ])
    expect(pois.map((p) => p.id)).toEqual(['osm:way/1', 'osm:node/3', 'osm:node/5', 'osm:node/6'])
    expect(merged).toBe(2)
  })

  it('Q9: no QID, score 0, no Japanese, not food → dropped', () => {
    const { pois } = dropWeakForeignNames([
      d('osm:node/1', 'Great view above Tokyo', 'viewpoint', { score: 0 }),
      d('osm:node/2', 'Sunshine observatory', 'viewpoint', { score: 0, tags: { wikidata: 'Q2' } }),
      d('osm:node/3', 'Boulangerie Le Cinq', 'bakery', { score: 0 }),
      d('osm:node/4', 'Old Stone', 'historic', { score: 2 }),
    ])
    expect(pois.map((p) => p.id)).toEqual(['osm:node/2', 'osm:node/3', 'osm:node/4'])
  })

  it('Q5: cafes etc. get +1 for a website and +0.5 for opening hours', () => {
    expect(appealScore({ category: 'cafe', tags: { website: 'https://x', opening_hours: 'Mo-Su 10:00-18:00' } })).toBe(1.5)
    expect(appealScore({ category: 'museum', tags: { website: 'https://x' } })).toBe(0)
  })
})

describe('Q1 municipalities from OPL', () => {
  it('reads admin_level=7 relations and finds which one contains a point', () => {
    const opl = [
      'n1 T x139.7 y35.6',
      'n2 T x139.8 y35.6',
      'n3 T x139.8 y35.7',
      'n4 T x139.7 y35.7',
      'w10 T Nn1,n2,n3',
      'w11 T Nn3,n4,n1',
      'r20 Tboundary=administrative,admin_level=7,name=%6c5f%%6771%%533a% Mw10@outer,w11@outer',
      'r21 Tboundary=administrative,admin_level=8,name=x Mw10@outer',
    ].join('\n')
    const areas = municipalitiesFromOpl(opl)
    expect(areas.map((a) => a.name)).toEqual(['江東区'])
    const of = municipalityLookup(areas)
    expect(of({ lat: 35.65, lng: 139.75 })).toBe('江東区')
    expect(of({ lat: 35.8, lng: 139.75 })).toBeUndefined()
  })
})

describe('Q15 photos from Commons categories', () => {
  it('uses the category image when there is no file tag, then the nearby search for the rest', async () => {
    const info = (u: string): PhotoInfo => ({ url: u, artist: 'a', license: 'CC BY 4.0' })
    const pois = [d('osm:way/1', '浅草寺', 'shrine', { tags: { wikimedia_commons: 'Category:Sensō-ji' }, score: 9 }), d('osm:way/2', '公園', 'park', { tags: { wikimedia_commons: 'Category:Nothing' }, score: 5 })]
    const category = vi.fn(async (cat: string) => (cat === 'Category:Sensō-ji' ? { title: 'File:Senso-ji.jpg', info: info('https://upload.wikimedia.org/x/thumb/a/ab/S.jpg/500px-S.jpg') } : null))
    const nearby = vi.fn(async () => info('https://upload.wikimedia.org/x/thumb/a/ab/N.jpg/500px-N.jpg'))
    const st = await attachPhotos(
      pois,
      { imageInfo: async (titles, w) => new Map(titles.map((t) => [t, info(`https://upload.wikimedia.org/x/thumb/a/ab/S.jpg/${w}px-S.jpg`)])), nearby, category },
      { categoryLimit: 10, nearbyLimit: 10 },
    )
    expect(st).toMatchObject({ categoryTried: 2, categoryFound: 1, nearbyTried: 1, nearbyFound: 1 })
    expect(pois[0].photo).toMatchObject({ url500: expect.stringContaining('500px'), url960: expect.stringContaining('960px') })
    expect(pois[0].photo?.nearby).toBeUndefined()
    expect(pois[1].photo?.nearby).toBe(true)
  })
})

describe('Q4 acquire: P31-only fallback and QID details are recorded', () => {
  it('warns when the class query fell back to P31 only; passes details and municipalities through', async () => {
    const ways: GeomWay[] = [
      { type: 'way', id: 1, geometry: [{ lat: 35.55, lon: 139.0 }, { lat: 35.55, lon: 139.92 }, { lat: 35.9, lon: 139.92 }, { lat: 35.9, lon: 139.0 }, { lat: 35.55, lon: 139.0 }] },
    ]
    const deps: AcquireDeps = {
      pbf: import.meta.filename,
      osmium: {
        available: () => true,
        poi: async () => [{ type: 'node', id: 1, lat: 35.68, lon: 139.76, tags: { name: 'x', tourism: 'viewpoint', wikidata: 'Q7' } }],
        boundary: async () => ways,
        timestamp: async () => 't',
        municipalities: async () => [{ name: '千代田区', ways }],
      },
      overpass: async () => ({ elements: [] }),
      overpassBoundary: async () => ways,
      wikidata: async () => ({ items: [], p31Only: true }),
      wikidataDetails: vi.fn(async (qids: string[]) => new Map(qids.map((q) => [q, { qid: q, label: 'ラベル', sitelinks: 3, heritage: false }]))),
    }
    const r = await acquire(deps)
    expect(r.warnings.join()).toMatch(/P31 のみ/)
    expect(r.warnStats.warn_wikidata_p31_only).toBe(1)
    expect(deps.wikidataDetails).toHaveBeenCalledWith(['Q7'])
    expect(r.wikidataDetails.get('Q7')?.label).toBe('ラベル')
    expect(r.municipalities.map((m) => m.name)).toEqual(['千代田区'])
  })
})
