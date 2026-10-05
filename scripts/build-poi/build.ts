/** 生成処理の本体（通信・ファイル I/O を含まない。fixture でテストできる） */
import { inCoverage, type StaticCoverage, type StaticIndex, type StaticTile, tileKey } from '../../src/lib/places/staticData'
import type { OverpassElement } from '../../src/lib/places/overpass'
import { mainlandRings, ringsBbox, type GeomWay } from './boundary'
import { appealScore, dedupePois, mergeSources, osmToDrafts, type PoiDraft } from './merge'
import { buildIndex, buildTiles } from './output'
import { attachPhotos, type PhotoSource } from './photos'
import type { WikidataItem } from './wikidata'

export interface BuildInput {
  overpassElements: readonly OverpassElement[]
  wikidata: readonly WikidataItem[]
  /** 境界ウェイ（out geom）。無い・組めないときは POI のあるタイルを対象範囲にする */
  boundaryWays?: readonly GeomWay[]
  /** 明示の対象範囲（サンプルデータ用。boundaryWays より優先） */
  coverage?: StaticCoverage
  photos?: PhotoSource
  nearbyLimit?: number
  generatedAt: string
  sample?: boolean
  log?: (msg: string) => void
}

export interface BuildOutput {
  pois: PoiDraft[]
  tiles: Map<string, StaticTile>
  index: StaticIndex
}

function cellsCoverage(pois: readonly PoiDraft[]): StaticCoverage {
  const cells = [...new Set(pois.map((p) => tileKey(p)))].sort()
  let s = Infinity
  let w = Infinity
  let n = -Infinity
  let e = -Infinity
  for (const c of cells) {
    const [a, b] = c.split('_').map((v) => Number(v) / 100)
    s = Math.min(s, a)
    w = Math.min(w, b)
    n = Math.max(n, a + 0.05)
    e = Math.max(e, b + 0.05)
  }
  const r = (v: number) => Math.round(v * 100) / 100
  return { bbox: cells.length ? [r(s), r(w), r(n), r(e)] : [0, 0, 0, 0], cells }
}

export async function buildDataset(input: BuildInput): Promise<BuildOutput> {
  const log = input.log ?? (() => {})
  const osm = osmToDrafts(input.overpassElements)
  log(`overpass: ${input.overpassElements.length} elements → ${osm.length} worth visiting (mainland)`)
  const { pois: merged, stats } = mergeSources(osm, input.wikidata)
  log(
    `merge: wikidata ${stats.wikidata} items, matched by tag ${stats.matchedByTag}, by name ${stats.matchedByName}, ` +
      `wikidata-only ${stats.wikidataOnly} (dropped ${stats.droppedWikidataOnly})`,
  )
  let coverage = input.coverage
  if (!coverage && input.boundaryWays?.length) {
    const rings = mainlandRings(input.boundaryWays)
    if (rings.length) coverage = { bbox: ringsBbox(rings), rings }
    log(`boundary: ${rings.length} mainland rings, ${rings.reduce((s, r) => s + r.length, 0)} points`)
  }
  let pois = coverage ? merged.filter((p) => inCoverage({ coverage: coverage! }, p)) : merged
  if (pois.length !== merged.length) log(`coverage: dropped ${merged.length - pois.length} outside the mainland polygon`)
  for (const d of pois) d.score = appealScore(d)
  pois = dedupePois(pois)
  log(`dedupe: ${pois.length} places`)
  let photoStats: Record<string, number> = {}
  if (input.photos) {
    const ps = await attachPhotos(pois, input.photos, { nearbyLimit: input.nearbyLimit ?? 0, log })
    photoStats = { photoFiles: ps.titles, nearbyTried: ps.nearbyTried }
    for (const d of pois) d.score = appealScore(d)
  }
  coverage ??= cellsCoverage(pois)
  const tiles = buildTiles(pois)
  const byCat: Record<string, number> = {}
  for (const d of pois) byCat[`cat_${d.category}`] = (byCat[`cat_${d.category}`] ?? 0) + 1
  // Wikidata のクラス別件数（ホワイトリストの QID が効いているかの確認用）
  for (const w of input.wikidata) byCat[`wd_${w.classQid}`] = (byCat[`wd_${w.classQid}`] ?? 0) + 1
  const index = buildIndex({
    tiles,
    coverage,
    generatedAt: input.generatedAt,
    sample: input.sample,
    stats: {
      osm: stats.osm,
      wikidata: stats.wikidata,
      matchedByTag: stats.matchedByTag,
      matchedByName: stats.matchedByName,
      wikidataOnly: stats.wikidataOnly,
      withPhoto: pois.filter((d) => d.photo).length,
      ...photoStats,
      ...byCat,
    },
  })
  return { pois, tiles, index }
}
