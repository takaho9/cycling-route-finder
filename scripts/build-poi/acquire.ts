/**
 * 取得の段取り（v1.3.1）。通信・osmium は差し替えられるようにして、失敗時の分岐をテストする。
 *
 * OSM:      Geofabrik PBF ＋ osmium（主経路）→ 失敗したら Overpass（0.1° グリッド × カテゴリ群、順次）
 * 境界:     PBF（主経路）→ 失敗したら Overpass の境界クエリ。どちらも駄目なら中止（都外の POI を公開しないため）
 * Wikidata: 失敗したら OSM だけで続行（警告）
 * Commons:  build.ts / photos.ts 側で、失敗したら写真なしで続行（警告）
 */
import { existsSync } from 'node:fs'
import { pointInRings } from '../../src/lib/places/staticData'
import type { OverpassElement } from '../../src/lib/places/overpass'
import { mainlandRings, type GeomWay } from './boundary'
import { TOKYO_STATION } from './config'
import { fetchOverpassGrid, gridCells } from './overpass-grid'
import type { WikidataDetail, WikidataItem } from './wikidata'

export type OsmSourceMode = 'auto' | 'geofabrik' | 'overpass'

export interface AcquireDeps {
  /** Geofabrik の PBF（または .osm）のパス */
  pbf?: string
  mode?: OsmSourceMode
  osmium: {
    available(): boolean
    poi(pbf: string): Promise<OverpassElement[]>
    boundary(pbf: string): Promise<GeomWay[]>
    timestamp(pbf: string): Promise<string | undefined>
    /** 市区町村（admin_level=7, v1.4 Q1） */
    municipalities?(pbf: string): Promise<{ name: string; ways: GeomWay[] }[]>
  }
  /** Overpass に 1 クエリ（エンドポイントの切替は実装側） */
  overpass(query: string): Promise<{ elements?: unknown[] }>
  /** Overpass の境界クエリ（フォールバック） */
  overpassBoundary(): Promise<GeomWay[]>
  /** p31Only = サブクラスをたどる版がタイムアウトして P31 のみで取った（v1.4 Q4: 警告） */
  wikidata(): Promise<WikidataItem[] | { items: WikidataItem[]; p31Only?: boolean }>
  /** OSM の wikidata タグの QID をクラスで絞らずに補完（v1.4 Q4） */
  wikidataDetails?(qids: string[]): Promise<Map<string, WikidataDetail>>
  gridGapMs?: number
  log?: (msg: string) => void
}

export interface Acquired {
  elements: OverpassElement[]
  boundaryWays: GeomWay[]
  wikidata: WikidataItem[]
  wikidataDetails: Map<string, WikidataDetail>
  municipalities: { name: string; ways: GeomWay[] }[]
  warnings: string[]
  warnStats: Record<string, number>
  osm: { source: 'geofabrik' | 'overpass'; timestamp?: string }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 境界が使えるか（本土リングがあり、東京駅を含む） */
export function boundaryUsable(ways: readonly GeomWay[] | undefined): boolean {
  if (!ways?.length) return false
  const rings = mainlandRings(ways)
  return rings.length > 0 && pointInRings(TOKYO_STATION, rings)
}

export async function acquire(deps: AcquireDeps): Promise<Acquired> {
  const log = deps.log ?? (() => {})
  const mode = deps.mode ?? 'auto'
  const warnings: string[] = []
  const warnStats: Record<string, number> = {}
  let elements: OverpassElement[] | null = null
  let boundaryWays: GeomWay[] | undefined
  let osm: Acquired['osm'] | null = null

  // ---- OSM: Geofabrik + osmium
  if (mode !== 'overpass') {
    const reason = !deps.pbf
      ? 'PBF が指定されていない'
      : !existsSync(deps.pbf)
        ? `PBF が無い（${deps.pbf}）`
        : !deps.osmium.available()
          ? 'osmium が無い'
          : null
    if (reason) {
      warnings.push(`Geofabrik を使えない: ${reason}`)
    } else {
      try {
        const t = Date.now()
        const ways = await deps.osmium.boundary(deps.pbf!)
        if (boundaryUsable(ways)) boundaryWays = ways
        else warnings.push('PBF から東京都の境界を組めなかった')
        const els = await deps.osmium.poi(deps.pbf!)
        if (els.length === 0) throw new Error('osmium の結果が 0 件')
        elements = els
        osm = { source: 'geofabrik', timestamp: await deps.osmium.timestamp(deps.pbf!) }
        log(`osm: geofabrik ${els.length} elements in ${((Date.now() - t) / 1000).toFixed(0)}s (data as of ${osm.timestamp ?? 'unknown'})`)
      } catch (e) {
        warnings.push(`Geofabrik/osmium で失敗: ${msg(e)}`)
        log(`osm: geofabrik failed: ${msg(e)}`)
      }
    }
    if (!elements) {
      warnStats.warn_geofabrik_failed = 1
      if (mode === 'geofabrik') throw new Error(`Geofabrik からの取得に失敗（mode=geofabrik のためフォールバックしない）: ${warnings.join(' / ')}`)
    }
  }

  // ---- 境界のフォールバック
  if (!boundaryWays) {
    try {
      const ways = await deps.overpassBoundary()
      if (boundaryUsable(ways)) boundaryWays = ways
    } catch (e) {
      log(`boundary: overpass failed: ${msg(e)}`)
    }
    if (!boundaryWays) throw new Error('東京都の境界を取得できない（都外の POI を公開しないため中止）')
    warnings.push('東京都の境界は Overpass から取得')
  }

  // ---- OSM: Overpass（グリッド分割）フォールバック
  if (!elements) {
    warnings.push('OSM は Overpass（0.1° グリッド × カテゴリ群）から取得')
    warnStats.warn_osm_overpass_fallback = 1
    const cells = gridCells(undefined, undefined, mainlandRings(boundaryWays))
    log(`osm: overpass grid ${cells.length} cells`)
    elements = await fetchOverpassGrid({
      cells,
      run: (q) => deps.overpass(q) as Promise<{ elements?: OverpassElement[] }>,
      gapMs: deps.gridGapMs,
      log,
    })
    if (elements.length === 0) throw new Error('Overpass（グリッド）の結果が 0 件')
    osm = { source: 'overpass', timestamp: new Date().toISOString() }
  }

  // ---- Wikidata（失敗しても OSM だけで続行）
  let wikidata: WikidataItem[] = []
  try {
    const got = await deps.wikidata()
    wikidata = Array.isArray(got) ? got : got.items
    if (!Array.isArray(got) && got.p31Only) {
      warnings.push('Wikidata は P31 のみのモードで取得（サブクラスを含む版がタイムアウト）。クラス別件数が少なめになる')
      warnStats.warn_wikidata_p31_only = 1
    }
  } catch (e) {
    warnings.push(`Wikidata SPARQL に失敗（OSM だけで続行）: ${msg(e)}`)
    warnStats.warn_wikidata_failed = 1
  }

  // OSM の wikidata タグの QID を補完（v1.4 Q4。失敗しても続行）
  let wikidataDetails = new Map<string, WikidataDetail>()
  if (deps.wikidataDetails) {
    const qids = [...new Set(elements.map((e) => e.tags?.wikidata?.split(';')[0].trim().toUpperCase()).filter((q): q is string => !!q && /^Q\d+$/.test(q)))]
    try {
      wikidataDetails = await deps.wikidataDetails(qids)
      log(`wikidata details: ${wikidataDetails.size}/${qids.length} QIDs`)
    } catch (e) {
      warnings.push(`Wikidata の QID 補完に失敗（ラベル・写真の補完なしで続行）: ${msg(e)}`)
      warnStats.warn_wikidata_details_failed = 1
    }
  }

  // 市区町村（v1.4 Q1。失敗しても続行: 汎用名に市区町村名を補えないだけ）
  let municipalities: Acquired['municipalities'] = []
  if (osm?.source === 'geofabrik' && deps.osmium.municipalities && deps.pbf) {
    try {
      municipalities = await deps.osmium.municipalities(deps.pbf)
      log(`municipalities: ${municipalities.length}`)
    } catch (e) {
      warnings.push(`市区町村の境界を取れなかった（汎用名に市区町村名を補わない）: ${msg(e)}`)
      warnStats.warn_municipalities_failed = 1
    }
  }

  return { elements, boundaryWays, wikidata, wikidataDetails, municipalities, warnings, warnStats, osm: osm! }
}
