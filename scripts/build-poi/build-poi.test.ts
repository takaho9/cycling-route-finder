// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PhotoInfo } from '../../src/lib/photos'
import type { OverpassResponse } from '../../src/lib/places/overpass'
import { inCoverage, tileKey, type StaticIndex, type StaticTile } from '../../src/lib/places/staticData'
import { assembleRings, buildBoundaryQuery, mainlandRings, simplify, type GeomWay } from './boundary'
import { buildDataset } from './build'
import { buildOverpassAreaQuery } from '../../src/lib/places/overpass'
import { appealScore, mergeSources, osmToDrafts, similarName } from './merge'
import { buildIndex, buildTiles, sanityCheck, writeOutput } from './output'
import type { PhotoSource } from './photos'
import { widerThumb } from './photos'
import { buildWikidataSparql, parseWikidataBindings, type SparqlJson } from './wikidata'

const FIX = join(import.meta.dirname, 'fixtures', 'test')
const SAMPLE = join(import.meta.dirname, 'fixtures', 'sample')
const read = <T>(dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T

const overpass = read<OverpassResponse>(FIX, 'overpass.json')
const wikidataJson = read<SparqlJson>(FIX, 'wikidata.json')
const boundary = read<{ elements: GeomWay[] }>(FIX, 'boundary.json')
const photoMap = read<Record<string, PhotoInfo>>(FIX, 'photos.json')

const photoSource = (calls: string[] = []): PhotoSource => ({
  async imageInfo(titles, width) {
    calls.push(`info:${width}:${titles.length}`)
    return new Map(titles.map((t) => [t, photoMap[t] ? { ...photoMap[t], url: photoMap[t].url.replace('/500px-', `/${width}px-`) } : null]))
  },
  async nearby(p) {
    calls.push(`nearby:${p.name}`)
    return null
  },
})

async function build(extra: Partial<Parameters<typeof buildDataset>[0]> = {}) {
  return buildDataset({
    overpassElements: overpass.elements ?? [],
    wikidata: parseWikidataBindings(wikidataJson),
    boundaryWays: boundary.elements,
    photos: photoSource(),
    generatedAt: '2026-10-05T00:00:00.000Z',
    ...extra,
  })
}

describe('queries', () => {
  it('Overpass: Tokyo area (JP-13) in one request, long timeout, reusing the app selectors', () => {
    const q = buildOverpassAreaQuery('["ISO3166-2"="JP-13"]', 180)
    expect(q).toContain('[timeout:180]')
    expect(q).toContain('area["ISO3166-2"="JP-13"]->.scope;')
    expect(q).toContain('node["tourism"="viewpoint"]["name"](area.scope);')
    expect(q).toContain('way["leisure"~"^(park|garden)$"]["name"]["access"!~"^(private|no)$"](area.scope);')
    expect(q).toContain('.p out tags bb;')
    expect(q).not.toContain('[bbox:')
    expect(buildBoundaryQuery()).toContain('rel["ISO3166-2"="JP-13"]["boundary"="administrative"];way(r);out geom;')
  })

  it('Wikidata: under Tokyo (P131* Q1490), with coordinates, ja label, P18, sitelinks, whitelisted classes', () => {
    const q = buildWikidataSparql()
    expect(q).toContain('wdt:P131* wd:Q1490')
    expect(q).toContain('wdt:P31/wdt:P279* ?root')
    expect(q).toContain('wdt:P625 ?coord')
    expect(q).toContain('wikibase:sitelinks ?sitelinks')
    expect(q).toContain('OPTIONAL { ?item wdt:P18 ?image }')
    expect(q).toContain('wd:Q845945')
    expect(buildWikidataSparql(false)).toContain('wdt:P31 ?root')
  })
})

describe('wikidata parsing', () => {
  it('collapses rows per item, picks the higher-priority class, normalizes P18', () => {
    const items = parseWikidataBindings(wikidataJson)
    expect(items).toHaveLength(9)
    const hibiya = items.find((i) => i.qid === 'Q900001')!
    expect(hibiya).toMatchObject({ label: '日比谷公園', lat: 35.6736, lng: 139.7561, sitelinks: 12, image: 'File:Hibiya Park.jpg' })
    // 庭園 (Q1107656) が 公園 (Q22698) より上
    expect(hibiya.classQid).toBe('Q1107656')
    expect(items.find((i) => i.qid === 'Q900003')!.heritage).toBe(true)
  })
})

describe('merge', () => {
  it('similarName: same, contained (>=3 chars), affix-stripped; not unrelated', () => {
    expect(similarName('日枝神社', '日枝神社')).toBe(true)
    expect(similarName('増上寺', '三縁山 増上寺')).toBe(true)
    expect(similarName('都立日比谷公園', '日比谷公園')).toBe(true)
    expect(similarName('日比谷公園（東京都）', '日比谷公園')).toBe(true)
    expect(similarName('日枝神社', '愛宕神社')).toBe(false)
    expect(similarName('寺', '増上寺')).toBe(false)
  })

  it('matches by wikidata tag, then by similar name within 150m; drops islands/noise; keeps wikidata-only with sitelinks', () => {
    const osm = osmToDrafts(overpass.elements ?? [])
    // 小さい公園・チェーン店・島しょ部は除外（範囲外カフェは境界チェックで後から落とす）
    expect(osm.map((d) => d.name)).not.toContain('ちびっこ児童遊園')
    expect(osm.map((d) => d.name)).not.toContain('スターバックス')
    expect(osm.map((d) => d.name)).not.toContain('三原山展望台')
    const { pois, stats } = mergeSources(osm, parseWikidataBindings(wikidataJson))
    expect(stats).toMatchObject({ matchedByTag: 1, matchedByName: 2, wikidataOnly: 3, droppedWikidataOnly: 3 })
    const by = (id: string) => pois.find((p) => p.id === id)!
    expect(by('osm:way/103').tags.wikidata).toBe('Q900002')
    expect(by('osm:way/103').sitelinks).toBe(8)
    expect(by('osm:way/104')).toMatchObject({ tags: expect.objectContaining({ wikidata: 'Q900003' }), wdHeritage: true })
    expect(by('osm:node/105').tags.wikidata).toBeUndefined() // 200m: 名前は同じでも距離で不一致
    expect(by('wd:Q900006')).toMatchObject({ name: '日本橋', category: 'attraction', p18: 'File:Nihonbashi.jpg' })
    expect(pois.find((p) => p.id === 'wd:Q900007')).toBeUndefined() // 橋は sitelinks 2 以上
    expect(pois.find((p) => p.id === 'wd:Q900008')).toBeUndefined() // sitelinks 0
    expect(pois.find((p) => p.id === 'wd:Q900009')).toBeUndefined() // 島しょ部
  })

  it('appeal score adds sitelinks, photo, heritage on top of attractiveness', () => {
    const base = appealScore({ tags: {} })
    expect(base).toBe(0)
    expect(appealScore({ tags: { wikidata: 'Q1' }, sitelinks: 15 })).toBe(3 + 4)
    expect(appealScore({ tags: {}, photo: { url500: 'a', url960: 'b' } })).toBe(2)
    expect(appealScore({ tags: {}, photo: { url500: 'a', url960: 'b', nearby: true } })).toBe(1)
    expect(appealScore({ tags: {}, wdHeritage: true })).toBe(2)
    expect(appealScore({ tags: { heritage: '2' }, wdHeritage: true })).toBe(2)
  })
})

describe('buildDataset (fixture end to end)', () => {
  it('dedupes, clips to the mainland polygon, embeds photos, splits into 0.05° tiles', async () => {
    const calls: string[] = []
    const { pois, tiles, index } = await build({ photos: photoSource(calls), nearbyLimit: 2 })
    const names = pois.map((p) => p.name).sort()
    // 同じ QID の way/node → 1 件、200m の同名 → 1 件、同名カフェ 120m → 1 件、範囲外カフェは落ちる
    expect(names.filter((n) => n === '日比谷公園')).toHaveLength(1)
    expect(names.filter((n) => n === '愛宕神社')).toHaveLength(1)
    expect(names.filter((n) => n === '東京大神宮')).toHaveLength(2)
    expect(names.filter((n) => n.startsWith('喫茶'))).toHaveLength(1)
    expect(names).not.toContain('範囲外カフェ')
    expect(pois.find((p) => p.name === '日比谷公園')!.id).toBe('osm:way/101') // 面積のある way が残る
    expect(pois.find((p) => p.name === '愛宕神社')!.id).toBe('wd:Q900004') // sitelinks のある方が残る

    // 写真: P18 と OSM wikimedia_commons。幅 500 / 960 をまとめて解決し、作者・ライセンスも
    const hibiya = pois.find((p) => p.name === '日比谷公園')!
    expect(hibiya.photo).toEqual({
      url500: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Hibiya_Park.jpg/500px-Hibiya_Park.jpg',
      url960: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Hibiya_Park.jpg/960px-Hibiya_Park.jpg',
      artist: 'Test Author',
      license: 'CC BY-SA 4.0',
      pageUrl: 'https://commons.wikimedia.org/wiki/File:Hibiya_Park.jpg',
    })
    expect(pois.find((p) => p.name === '浅草寺')!.photo?.license).toBe('CC BY 4.0')
    expect(calls.filter((c) => c.startsWith('info:'))).toEqual(['info:500:3', 'info:960:2']) // 960px は写真のあるファイルだけ
    // 近傍検索は上限 2 件・公園/展望/寺社/史跡のみ
    expect(calls.filter((c) => c.startsWith('nearby:'))).toHaveLength(2)

    // タイル: キーと中身が一致、件数の合計 = index.count
    let total = 0
    for (const [k, t] of tiles) {
      expect(t.k).toBe(k)
      for (const r of t.p) expect(tileKey({ lat: r.y, lng: r.x })).toBe(k)
      total += t.p.length
      expect(index.tiles[k]).toBe(t.p.length)
    }
    expect(total).toBe(index.count)
    expect(index.count).toBe(pois.length)
    expect([...tiles.keys()]).toEqual(expect.arrayContaining(['3565_13970', '3565_13975', '3570_13975']))
    // 対象範囲は本土リングのみ（島のリングは捨てる）
    expect(index.coverage.rings).toHaveLength(1)
    expect(inCoverage(index, { lat: 35.6812, lng: 139.7671 })).toBe(true)
    expect(inCoverage(index, { lat: 34.75, lng: 139.4 })).toBe(false)
    expect(index.sources.map((s) => s.name).join()).toMatch(/OpenStreetMap.*Wikidata.*Commons/)

    // 写真のある record は画像タグを持たない。短縮形
    const rec = tiles.get(tileKey(hibiya))!.p.find((r) => r.i === 'osm:way/101')!
    expect(rec).toMatchObject({ n: '日比谷公園', c: 'park', t: { wikidata: 'Q900001', size_m: expect.any(String) }, w: 12, p: { m: expect.any(String), l: expect.any(String), a: 'Test Author', c: 'CC BY-SA 4.0' } })
    expect(rec.s).toBeGreaterThan(8)
  })

  it('is deterministic (same input → same version hash)', async () => {
    const a = await build()
    const b = await build({ generatedAt: '2030-01-01T00:00:00.000Z' })
    expect(a.index.version).toBe(b.index.version)
  })

  it('without a boundary falls back to POI cells as the coverage', async () => {
    const { index } = await build({ boundaryWays: undefined })
    expect(index.coverage.rings).toBeUndefined()
    expect(index.coverage.cells).toEqual(Object.keys(index.tiles).sort())
  })
})

describe('boundary', () => {
  it('assembles rings from unordered / reversed ways and simplifies', () => {
    const rings = assembleRings(boundary.elements)
    expect(rings).toHaveLength(2)
    expect(mainlandRings(boundary.elements)).toHaveLength(1)
    const line: [number, number][] = [
      [0, 0],
      [0.00001, 1],
      [0, 2],
      [1, 2],
    ]
    expect(simplify(line, 0.001)).toEqual([
      [0, 0],
      [0, 2],
      [1, 2],
    ])
  })
})

describe('sanity check', () => {
  const idx = (count: number) => ({ count, tiles: (count ? { a: count } : {}) as Record<string, number> })
  it('fails below the minimum count and with no tiles', () => {
    expect(sanityCheck(idx(0), { minCount: 1 })).toHaveLength(2)
    expect(sanityCheck(idx(2999), { minCount: 3000 })[0]).toMatch(/最低 3000/)
    expect(sanityCheck(idx(3000), { minCount: 3000 })).toEqual([])
  })
  it('fails when the count drops 30% or more from the previous run (sample data is not compared)', () => {
    expect(sanityCheck(idx(7000), { minCount: 1, prev: { count: 10000 } })[0]).toMatch(/前回比 30.0% 減/)
    expect(sanityCheck(idx(7001), { minCount: 1, prev: { count: 10000 } })).toEqual([])
    expect(sanityCheck(idx(10), { minCount: 1, prev: { count: 10000, sample: true } })).toEqual([])
  })
})

describe('output', () => {
  it('writes minified tiles + index and removes tiles that disappeared', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'poi-'))
    writeFileSync(join(dir, 't_9999_9999.json'), '{}')
    const { tiles, index } = await build()
    writeOutput(dir, tiles, index)
    const files = readdirSync(dir).sort()
    expect(files).toEqual(['index.json', ...[...tiles.keys()].map((k) => `t_${k}.json`)].sort())
    const raw = readFileSync(join(dir, 'index.json'), 'utf8')
    expect(raw).not.toMatch(/\n/)
    const parsed = JSON.parse(raw) as StaticIndex
    expect(parsed.count).toBe(index.count)
    expect(JSON.parse(readFileSync(join(dir, files[1]), 'utf8')) as StaticTile).toHaveProperty('p')
  })

  it('buildIndex marks sample data', () => {
    const tiles = buildTiles([{ id: 'x', name: 'x', lat: 35.68, lng: 139.76, category: 'park', tags: {}, score: 1 }])
    const index = buildIndex({ tiles, coverage: { bbox: [35, 139, 36, 140] }, generatedAt: 'now', sample: true })
    expect(index).toMatchObject({ sample: true, count: 1, tiles: { '3565_13975': 1 } })
  })

  it('widerThumb rewrites the Commons thumb width', () => {
    expect(widerThumb('https://upload.wikimedia.org/x/thumb/a/ab/F.jpg/500px-F.jpg')).toBe('https://upload.wikimedia.org/x/thumb/a/ab/F.jpg/960px-F.jpg')
    expect(widerThumb('https://upload.wikimedia.org/x/a/ab/F.jpg')).toBe('https://upload.wikimedia.org/x/a/ab/F.jpg')
  })
})

describe('CLI (fixture mode)', () => {
  it('generates the sample data set and refuses to publish an empty one', () => {
    const out = mkdtempSync(join(tmpdir(), 'poi-cli-'))
    const tsx = join(import.meta.dirname, '..', '..', 'node_modules', '.bin', 'tsx')
    const main = join(import.meta.dirname, 'main.ts')
    const log = execFileSync(tsx, [main, '--fixture', SAMPLE, '--sample', '--out', out], { encoding: 'utf8' })
    expect(log).toMatch(/result: \d+ places in \d+ tiles/)
    const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')) as StaticIndex
    expect(index.sample).toBe(true)
    expect(index.count).toBeGreaterThanOrEqual(30)
    // 空の fixture → 健全性チェックで失敗（exit 2）、前回のデータは残る
    const empty = mkdtempSync(join(tmpdir(), 'poi-empty-'))
    writeFileSync(join(empty, 'overpass.json'), '{"elements":[]}')
    writeFileSync(join(empty, 'wikidata.json'), '{}')
    let code = 0
    try {
      execFileSync(tsx, [main, '--fixture', empty, '--out', out], { encoding: 'utf8', stdio: 'pipe' })
    } catch (e) {
      code = (e as { status: number }).status
    }
    expect(code).toBe(2)
    expect((JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')) as StaticIndex).version).toBe(index.version)
  }, 30_000)
})
