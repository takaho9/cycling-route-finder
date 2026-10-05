/** 生成処理の本体（通信・ファイル I/O を含まない。fixture でテストできる） */
import { inCoverage, type StaticCoverage, type StaticIndex, type StaticTile, tileKey } from '../../src/lib/places/staticData'
import type { OverpassElement } from '../../src/lib/places/overpass'
import { mainlandRings, ringsBbox, type GeomWay } from './boundary'
import { appealScore, dedupePois, mergeSources, osmToDrafts, type PoiDraft } from './merge'
import { buildIndex, buildTiles } from './output'
import { attachPhotos, type PhotoSource } from './photos'
import { applyNaming } from './naming'
import { applyQualityRules, dropWeakForeignNames, mergeNearSimilar, qualityPenalty } from './quality'

/** 写真ファイルのうち、これ未満しかサムネに解決できなければ警告 */
export const PHOTO_MIN_RESOLVE_RATIO = 0.5
import type { WikidataDetail, WikidataItem } from './wikidata'
import type { LatLng } from '../../src/lib/types'

export interface BuildInput {
  overpassElements: readonly OverpassElement[]
  wikidata: readonly WikidataItem[]
  /** OSM の wikidata タグにある QID の補完（ラベル・P18・sitelinks・P1435, v1.4 Q4） */
  wikidataDetails?: ReadonlyMap<string, WikidataDetail>
  /** 市区町村名（汎用名の補い, v1.4 Q1） */
  municipalityOf?: (p: LatLng) => string | undefined
  /** 境界ウェイ（out geom）。無い・組めないときは POI のあるタイルを対象範囲にする */
  boundaryWays?: readonly GeomWay[]
  /** 明示の対象範囲（サンプルデータ用。boundaryWays より優先） */
  coverage?: StaticCoverage
  photos?: PhotoSource
  nearbyLimit?: number
  /** Category: リンクから代表画像をさがす上限（v1.4 Q15） */
  categoryPhotoLimit?: number
  generatedAt: string
  sample?: boolean
  /** 呼び出し側で出た警告（Wikidata 失敗・OSM の取得経路など） */
  warnings?: string[]
  osm?: StaticIndex['osm']
  /** 警告の数値版（stats に warn_* として入れる） */
  warnStats?: Record<string, number>
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
  const { pois: merged, stats } = mergeSources(osm, input.wikidata, input.wikidataDetails)
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
  // 名前の付け直し（v1.4 Q1）: 汎用名・付属建物名・英語名 → Wikidata ラベル / 市区町村名
  const naming = applyNaming(pois, { municipalityOf: input.municipalityOf })
  pois = naming.pois
  log(`naming: by wikidata label ${naming.stats.byLabel}, by city ${naming.stats.byCity}, dropped sub-buildings ${naming.stats.droppedParts}`)
  // 品質ルール（v1.3.2 / v1.4）: 目的地でない・小さな史跡・チェーン・寺社の付属建物・境内や園内の吸収
  const q = applyQualityRules(pois)
  pois = q.pois
  log(
    `quality: chain by name ${q.stats.chainByName}, auto chain ${q.stats.chainAuto} (${q.stats.autoChainNames.length} names), ` +
      `worship parts ${q.stats.worshipPart}, absorbed ${q.stats.absorbed}, minor worship nodes dropped ${q.stats.minorWorship}, ` +
      `not destinations ${q.stats.notDestination}, small monuments ${q.stats.smallMonument}`,
  )
  if (q.stats.autoChainNames.length) log(`quality: auto chains: ${q.stats.autoChainNames.slice(0, 40).join(', ')}`)
  const score = (d: PoiDraft) => Math.round((appealScore(d) - qualityPenalty(d)) * 10) / 10
  for (const d of pois) d.score = score(d)
  const foreign = dropWeakForeignNames(pois)
  pois = foreign.pois
  pois = dedupePois(pois)
  const near = mergeNearSimilar(pois)
  pois = near.pois
  log(`dedupe: ${pois.length} places (weak foreign names ${foreign.dropped}, merged within 60m ${near.merged})`)
  const warnings = [...(input.warnings ?? [])]
  let photoStats: Record<string, number> = {}
  if (input.photos) {
    const ps = await attachPhotos(pois, input.photos, { nearbyLimit: input.nearbyLimit ?? 0, categoryLimit: input.categoryPhotoLimit ?? 0, log })
    photoStats = { photoFiles: ps.titles, categoryTried: ps.categoryTried, categoryFound: ps.categoryFound, nearbyTried: ps.nearbyTried, nearbyFound: ps.nearbyFound }
    // Commons が失敗しても写真なしで続行する（警告を残す）
    if (ps.infoFailed) {
      photoStats.warn_commons_imageinfo_failed = ps.infoFailed
      warnings.push(`Commons imageinfo に失敗: ${ps.infoFailed}/${ps.titles} ファイル（写真なしで続行）`)
    }
    // 解決率が極端に低いときは応答の解釈がおかしい可能性が高い（v1.3.2 の不具合の再発検知）
    photoStats.photoResolved = ps.resolved
    if (ps.titles >= 50 && ps.resolved / ps.titles < PHOTO_MIN_RESOLVE_RATIO) {
      photoStats.warn_photo_resolve_rate_low = 1
      warnings.push(`写真の解決率が低い: ${ps.resolved}/${ps.titles}（応答形式の変化などを疑う）`)
    }
    if (ps.nearbyErrors) {
      photoStats.warn_commons_nearby_errors = ps.nearbyErrors
      warnings.push(`Commons 近傍検索の失敗: ${ps.nearbyErrors} 件${ps.nearbyAborted ? '（連続失敗で打ち切り）' : ''}`)
    }
    for (const d of pois) d.score = score(d)
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
    warnings,
    osm: input.osm,
    stats: {
      osm: stats.osm,
      wikidata: stats.wikidata,
      matchedByTag: stats.matchedByTag,
      matchedByName: stats.matchedByName,
      wikidataOnly: stats.wikidataOnly,
      withPhoto: pois.filter((d) => d.photo).length,
      ...photoStats,
      q_chain_name: q.stats.chainByName,
      q_chain_auto: q.stats.chainAuto,
      q_worship_part: q.stats.worshipPart,
      q_absorbed: q.stats.absorbed,
      q_minor_worship: q.stats.minorWorship,
      q_not_destination: q.stats.notDestination,
      q_small_monument: q.stats.smallMonument,
      q_weak_foreign: foreign.dropped,
      q_near_merged: near.merged,
      q_name_by_label: naming.stats.byLabel,
      q_name_by_city: naming.stats.byCity,
      q_name_dropped_parts: naming.stats.droppedParts,
      ...(input.warnStats ?? {}),
      ...byCat,
      ...(warnings.length ? { warn_count: warnings.length } : {}),
    },
  })
  return { pois, tiles, index }
}
