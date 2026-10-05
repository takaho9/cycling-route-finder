// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OVERPASS_SELECTORS, type OverpassElement } from '../../src/lib/places/overpass'
import type { StaticIndex } from '../../src/lib/places/staticData'
import { acquire, boundaryUsable, type AcquireDeps } from './acquire'
import { mainlandRings, type GeomWay } from './boundary'
import { buildDataset } from './build'
import {
  boundaryWaysFromOpl,
  boundaryWaysFromPbf,
  condMatches,
  decodeOpl,
  featuresToElements,
  matchSelectors,
  osmiumAvailable,
  parseSelectorFilter,
  poiElementsFromPbf,
  tagsFilterExpressions,
} from './osm-pbf'
import { buildCellQuery, cellTouchesRings, fetchOverpassGrid, gridCells, selectorGroups } from './overpass-grid'
import { attachPhotos, NEARBY_MAX_CONSECUTIVE_ERRORS, type PhotoSource } from './photos'
import type { PoiDraft } from './merge'
import type { WikidataItem } from './wikidata'

const FIX = join(import.meta.dirname, 'fixtures', 'osm')
const MINI = join(FIX, 'mini.osm')
const geojsonLines = readFileSync(join(FIX, 'poi.geojsonseq'), 'utf8').split('\n')
const opl = readFileSync(join(FIX, 'boundary.opl'), 'utf8')
const HAS_OSMIUM = osmiumAvailable()

describe('selectors → osmium tags-filter / JS predicates (same definition as Overpass)', () => {
  it('derives tags-filter expressions from the primary tag of every selector', () => {
    const ex = tagsFilterExpressions()
    expect(ex).toContain('n/tourism=viewpoint,attraction,museum,gallery')
    expect(ex).toContain('wr/leisure=park,garden,marina')
    expect(ex).toContain('n/amenity=cafe,place_of_worship,ice_cream')
    expect(ex).toContain('wr/natural=beach,water')
    // cafe はノードのみ（Overpass のセレクタと同じ）
    expect(ex.find((e) => e.startsWith('wr/amenity'))).toBe('wr/amenity=place_of_worship')
  })

  it('evaluates Overpass conditions like Overpass (absent key passes != / !~)', () => {
    const [a] = parseSelectorFilter('["access"!~"^(private|no)$"]')
    expect(condMatches(a, {})).toBe(true)
    expect(condMatches(a, { access: 'private' })).toBe(false)
    const [b] = parseSelectorFilter('[!"brand"]')
    expect(condMatches(b, {})).toBe(true)
    expect(condMatches(b, { brand: 'x' })).toBe(false)
  })

  it('matches the remaining conditions per element kind', () => {
    expect(matchSelectors('node', { name: 'c', amenity: 'cafe' }).matched).toBe(true)
    expect(matchSelectors('node', { name: 'c', amenity: 'cafe', brand: 'S' }).matched).toBe(false)
    expect(matchSelectors('way', { name: 'c', amenity: 'cafe' }).matched).toBe(false)
    expect(matchSelectors('node', { amenity: 'cafe' }).matched).toBe(false)
    expect(matchSelectors('way', { name: 'p', leisure: 'park' })).toEqual({ matched: true, park: true })
    expect(matchSelectors('way', { name: 'p', leisure: 'park', access: 'private' }).matched).toBe(false)
    expect(matchSelectors('relation', { name: 'w', natural: 'water', water: 'pond' })).toEqual({ matched: true, park: false })
    expect(matchSelectors('relation', { name: 'w', natural: 'water', water: 'river' }).matched).toBe(false)
    expect(matchSelectors('way', { name: 'x', amenity: 'place_of_worship', religion: 'christian' }).matched).toBe(false)
    expect(matchSelectors('node', { name: '道の駅 八王子滝山', highway: 'rest_area' }).matched).toBe(true)
  })
})

describe('GeoJSON Seq (osmium export) → Overpass-shaped elements', () => {
  const els = featuresToElements(geojsonLines)
  const by = (k: string) => els.find((e) => `${e.type}/${e.id}` === k)

  it('drops non-matching features and dedupes LineString/Polygon of the same closed way', () => {
    expect(els.map((e) => `${e.type}/${e.id}`).sort()).toEqual(
      ['node/1001', 'node/1004', 'node/1006', 'node/1008', 'node/1009', 'relation/3001', 'way/2001', 'way/2002', 'way/2003'].sort(),
    )
  })

  it('parks get a bbox (size check), other areas get the bbox center; nodes keep their position', () => {
    expect(by('way/2001')).toMatchObject({ bounds: { minlat: 35.6715, minlon: 139.7538, maxlat: 35.6755, maxlon: 139.7582 } })
    expect(by('way/2001')!.center).toBeUndefined()
    expect(by('way/2003')).toMatchObject({ center: { lat: 35.6746, lon: 139.7395 } })
    expect(by('relation/3001')).toMatchObject({ bounds: expect.any(Object), tags: { name: '浜離宮恩賜庭園', leisure: 'garden' } })
    expect(by('node/1001')).toMatchObject({ lat: 35.6798, lon: 139.7647 })
  })

  it('feeds the existing pipeline (categorize / isWorthVisiting / merge / clip to Tokyo)', async () => {
    const { pois } = await buildDataset({
      overpassElements: els,
      wikidata: [],
      boundaryWays: boundaryWaysFromOpl(opl),
      generatedAt: 'x',
    })
    const names = pois.map((p) => p.name).sort()
    // 「大きな神社」は wikidata も heritage も無い単独 node の寺社なので除外（v1.3.2 ルール A）
    expect(names).toEqual(['KITTEガーデン', '喫茶テスト', '日枝神社', '日比谷公園', '東京国立博物館', '浜離宮恩賜庭園'].sort())
    // 小さな公園（isWorthVisiting）・川崎（境界の外）は落ちる。浜離宮は「浜」だけでは海辺にしない（v1.3.2）
    expect(pois.find((p) => p.name === '浜離宮恩賜庭園')).toMatchObject({ category: 'park', tags: { size_m: expect.any(String) } })
  })
})

describe('boundary from OPL', () => {
  it('decodes OPL escapes and returns the outer ways of the Tokyo relation', () => {
    expect(decodeOpl('%6771%%4eac%%90fd%')).toBe('東京都')
    const ways = boundaryWaysFromOpl(opl)
    expect(ways.map((w) => w.id).sort()).toEqual([2101, 2102, 2103, 2104])
    expect(mainlandRings(ways)).toHaveLength(1)
    expect(boundaryUsable(ways)).toBe(true)
  })

  it('skips members that are missing from the extract (e.g. far islands)', () => {
    const partial = opl
      .split('\n')
      .filter((l) => !l.startsWith('w2104'))
      .join('\n')
    expect(boundaryWaysFromOpl(partial).map((w) => w.id)).not.toContain(2104)
  })
})

describe.skipIf(!HAS_OSMIUM)('osmium (real binary, small .osm fixture)', () => {
  it('extract → tags-filter → export gives the same elements as the committed GeoJSON fixture', async () => {
    const work = mkdtempSync(join(tmpdir(), 'osmium-'))
    const els = await poiElementsFromPbf(MINI, { workDir: work })
    const key = (e: OverpassElement) => `${e.type}/${e.id}`
    expect(els.map(key).sort()).toEqual(featuresToElements(geojsonLines).map(key).sort())
    // bbox の外（緯度 36.5）は extract で落ちる
    expect(els.find((e) => e.tags?.name === '遠くの展望台')).toBeUndefined()
    const ways = await boundaryWaysFromPbf(MINI, { workDir: work })
    expect(boundaryUsable(ways)).toBe(true)
  })

  it('CLI: --fixture + --pbf builds the data set through osmium', () => {
    const out = mkdtempSync(join(tmpdir(), 'poi-osmium-'))
    const tsx = join(import.meta.dirname, '..', '..', 'node_modules', '.bin', 'tsx')
    execFileSync(tsx, [join(import.meta.dirname, 'main.ts'), '--fixture', FIX, '--pbf', MINI, '--out', out, '--work-dir', join(out, 'work')], {
      encoding: 'utf8',
    })
    const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')) as StaticIndex
    expect(index.count).toBe(6)
    expect(index.coverage.rings).toHaveLength(1)
    expect(index.osm).toEqual({ source: 'fixture' })
  }, 30_000)
})

describe('Overpass fallback grid', () => {
  it('splits the selectors into groups that cover every selector exactly once', () => {
    const groups = selectorGroups()
    expect(groups.length).toBe(3)
    expect(groups.flat().sort((a, b) => a.filter.localeCompare(b.filter))).toEqual([...OVERPASS_SELECTORS].sort((a, b) => a.filter.localeCompare(b.filter)))
  })

  it('0.1° cells over the bbox, minus cells that miss the Tokyo polygon', () => {
    expect(gridCells([35.4, 139.0, 35.6, 139.3], 0.1)).toHaveLength(6)
    const rings = mainlandRings(boundaryWaysFromOpl(opl)) // 35.55–35.9 × 139.0–139.92
    const cells = gridCells(undefined, 0.1, rings)
    expect(cells.length).toBeLessThan(gridCells(undefined, 0.1).length)
    expect(cells.every((c) => cellTouchesRings(c, rings))).toBe(true)
    expect(cells.some((c) => c.n < 35.55)).toBe(false)
  })

  it('cell query: own bbox, short timeout, only the given selectors', () => {
    const q = buildCellQuery({ s: 35.6, w: 139.7, n: 35.7, e: 139.8 }, selectorGroups()[2])
    expect(q).toContain('[timeout:90][bbox:35.6,139.7,35.7,139.8];')
    expect(q).toContain('node["amenity"="cafe"]')
    expect(q).not.toContain('leisure')
  })

  it('runs strictly one query at a time and fails as a whole if one query fails', async () => {
    let active = 0
    let maxActive = 0
    const run = vi.fn(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 1))
      active--
      return { elements: [{ type: 'node' as const, id: 1, lat: 35.6, lon: 139.7, tags: { name: 'a' } }] }
    })
    const cells = [
      { s: 35.6, w: 139.7, n: 35.7, e: 139.8 },
      { s: 35.7, w: 139.7, n: 35.8, e: 139.8 },
    ]
    const els = await fetchOverpassGrid({ cells, run, gapMs: 0 })
    expect(run).toHaveBeenCalledTimes(6)
    expect(maxActive).toBe(1)
    expect(els).toHaveLength(1) // 重複除去
    const failing = vi.fn(async () => {
      throw new Error('504')
    })
    await expect(fetchOverpassGrid({ cells, run: failing, gapMs: 0 })).rejects.toThrow('504')
    expect(failing).toHaveBeenCalledTimes(1)
  })
})

describe('acquire: source order and failure handling', () => {
  const tokyoWays = boundaryWaysFromOpl(opl)
  const pbfEls = featuresToElements(geojsonLines)
  const wdItem: WikidataItem = { qid: 'Q1', label: 'x', lat: 35.68, lng: 139.76, sitelinks: 3, classQid: 'Q22698', category: 'park', heritage: false }
  const deps = (over: Partial<AcquireDeps> = {}, osmium: Partial<AcquireDeps['osmium']> = {}) => {
    const d = {
      pbf: MINI, // 存在するファイルなら何でもよい（osmium はモック）
      osmium: {
        available: () => true,
        poi: vi.fn(async () => pbfEls),
        boundary: vi.fn(async () => tokyoWays),
        timestamp: async () => '2026-10-04T20:21:02Z',
        ...osmium,
      },
      overpass: vi.fn(async () => ({ elements: [{ type: 'node', id: 9, lat: 35.68, lon: 139.76, tags: { name: 'o', tourism: 'viewpoint' } }] })),
      overpassBoundary: vi.fn(async () => tokyoWays as GeomWay[]),
      wikidata: vi.fn(async () => [wdItem]),
      gridGapMs: 0,
      ...over,
    }
    return d
  }

  it('Geofabrik succeeds → Overpass is never called', async () => {
    const d = deps()
    const r = await acquire(d)
    expect(r.osm).toEqual({ source: 'geofabrik', timestamp: '2026-10-04T20:21:02Z' })
    expect(r.elements).toBe(pbfEls)
    expect(r.warnings).toEqual([])
    expect(d.overpass).not.toHaveBeenCalled()
    expect(d.overpassBoundary).not.toHaveBeenCalled()
    expect(r.wikidata).toEqual([wdItem])
  })

  it('PBF missing → Overpass grid (sequential, Tokyo cells only) with warnings', async () => {
    const d = deps({ pbf: '/nonexistent.osm.pbf' })
    const r = await acquire(d)
    expect(r.osm.source).toBe('overpass')
    expect(d.overpassBoundary).toHaveBeenCalledTimes(1)
    const cells = gridCells(undefined, undefined, mainlandRings(tokyoWays))
    expect(d.overpass).toHaveBeenCalledTimes(cells.length * selectorGroups().length)
    expect(r.warnings.join()).toMatch(/PBF が無い.*Overpass（0.1° グリッド/)
    expect(r.warnStats).toMatchObject({ warn_geofabrik_failed: 1, warn_osm_overpass_fallback: 1 })
  })

  it('osmium failure → Overpass grid; with --osm-source geofabrik it stops instead', async () => {
    const boom = { poi: vi.fn(async () => Promise.reject(new Error('osmium export exited with 1'))) }
    const r = await acquire(deps({}, boom))
    expect(r.osm.source).toBe('overpass')
    expect(r.warnings[0]).toMatch(/osmium export exited with 1/)
    await expect(acquire(deps({ mode: 'geofabrik' }, boom))).rejects.toThrow(/フォールバックしない/)
  })

  it('no usable Tokyo boundary anywhere → abort (never publish POIs outside Tokyo)', async () => {
    const d = deps({ overpassBoundary: vi.fn(async () => Promise.reject(new Error('504'))) }, { boundary: vi.fn(async () => []) })
    await expect(acquire(d)).rejects.toThrow(/境界を取得できない/)
  })

  it('Wikidata failure → continue with OSM only and warn', async () => {
    const r = await acquire(deps({ wikidata: vi.fn(async () => Promise.reject(new Error('HTTP 503'))) }))
    expect(r.wikidata).toEqual([])
    expect(r.warnings.join()).toMatch(/Wikidata SPARQL に失敗（OSM だけで続行）: HTTP 503/)
    expect(r.warnStats.warn_wikidata_failed).toBe(1)
    const { index } = await buildDataset({ overpassElements: r.elements, wikidata: r.wikidata, boundaryWays: r.boundaryWays, warnings: r.warnings, warnStats: r.warnStats, generatedAt: 'x' })
    expect(index.count).toBeGreaterThan(0)
    expect(index.warnings?.join()).toMatch(/Wikidata/)
    expect(index.stats).toMatchObject({ warn_wikidata_failed: 1, warn_count: 1 })
  })
})

describe('Commons failure handling', () => {
  const draft = (id: string, extra: Partial<PoiDraft> = {}): PoiDraft => ({ id, name: id, lat: 35.68, lng: 139.76, category: 'park', tags: {}, ...extra })

  it('imageinfo failure → no photos, keep going, warn in index.warnings / stats', async () => {
    const source: PhotoSource = {
      imageInfo: async () => {
        throw new Error('HTTP 503')
      },
      nearby: async () => null,
    }
    const { index, pois } = await buildDataset({
      overpassElements: featuresToElements(geojsonLines).map((e) => (e.id === 2001 ? { ...e, tags: { ...e.tags, wikimedia_commons: 'File:A.jpg' } } : e)),
      wikidata: [],
      boundaryWays: boundaryWaysFromOpl(opl),
      photos: source,
      generatedAt: 'x',
    })
    expect(pois.every((p) => !p.photo)).toBe(true)
    expect(index.stats?.warn_commons_imageinfo_failed).toBe(1)
    expect(index.warnings?.[0]).toMatch(/Commons imageinfo に失敗: 1\/1/)
    expect(index.count).toBe(6)
  })

  it('nearby search stops after consecutive errors (does not hammer a down Commons)', async () => {
    const nearby = vi.fn(async () => {
      throw new Error('timeout')
    })
    const pois = Array.from({ length: 20 }, (_, i) => draft(`p${i}`))
    const st = await attachPhotos(pois, { imageInfo: async () => new Map(), nearby }, { nearbyLimit: 20 })
    expect(nearby).toHaveBeenCalledTimes(NEARBY_MAX_CONSECUTIVE_ERRORS)
    expect(st).toMatchObject({ nearbyErrors: NEARBY_MAX_CONSECUTIVE_ERRORS, nearbyAborted: true, infoFailed: 0 })
  })
})
