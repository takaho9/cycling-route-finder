/**
 * 都内の目的地データを事前生成して public/data/tokyo/ に書き出す（v1.3 / v1.3.1）。
 *
 *   本番（GitHub Actions）: npx tsx scripts/build-poi/main.ts --pbf .cache/osm/kanto-latest.osm.pbf
 *   fixture から:           npx tsx scripts/build-poi/main.ts --fixture scripts/build-poi/fixtures/sample --sample
 *
 * OSM の取得経路（v1.3.1）: Geofabrik 関東 PBF ＋ osmium（主経路）→ 失敗時のみ Overpass（0.1° グリッド × カテゴリ群・順次）。
 * Wikidata が失敗したら OSM だけで、Commons が失敗したら写真なしで続行し、警告を stats / Summary に出す。
 *
 * オプション:
 *   --out <dir>          出力先（既定 public/data/tokyo）
 *   --pbf <file>         Geofabrik の PBF（.osm XML も可）。fixture モードでも指定すると OSM 部分は osmium で読む
 *   --work-dir <dir>     osmium の中間ファイル置き場（既定 .cache/osm/work）
 *   --osm-source <m>     auto（既定: Geofabrik → Overpass）| geofabrik（フォールバックしない）| overpass
 *   --fixture <dir>      通信せず fixture を使う（overpass.json / wikidata.json / [boundary.json] / [coverage.json] / [photos.json]）
 *   --sample             index.json に "sample": true を入れる（網羅性の無いサンプル）
 *   --min-count <n>      最低件数（既定: 本番 3000 / fixture 1）
 *   --nearby-limit <n>   Commons 近傍検索の上限（既定 300。0 で無効）
 *   --no-photos          写真の解決をしない
 *   --allow-shrink       前回比の減少チェックを無効にする（意図的に減らすときだけ）
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { fetchJson, HttpError, sleep } from '../../src/lib/http'
import { checkOverpassRemark, type OverpassElement, type OverpassResponse } from '../../src/lib/places/overpass'
import type { PhotoInfo } from '../../src/lib/photos'
import type { StaticCoverage, StaticIndex } from '../../src/lib/places/staticData'
import { acquire, type OsmSourceMode } from './acquire'
import { buildBoundaryQuery, type GeomWay } from './boundary'
import { buildDataset } from './build'
import { BUILD_OVERPASS_ENDPOINTS, DEFAULT_MIN_COUNT, DEFAULT_NEARBY_LIMIT, OVERPASS_GRID_TIMEOUT_S, userAgent, WIKIDATA_SPARQL_ENDPOINT } from './config'
import { boundaryWaysFromPbf, osmiumAvailable, pbfTimestamp, poiElementsFromPbf } from './osm-pbf'
import { readPrevIndex, sanityCheck, writeOutput } from './output'
import { commonsPhotoSource, type PhotoSource } from './photos'
import { buildWikidataSparql, parseWikidataBindings, type SparqlJson, type WikidataItem } from './wikidata'

const log = (msg: string) => console.log(`[build-poi] ${msg}`)

/**
 * 全リクエストに User-Agent（連絡先つき）を付け、429/5xx/通信エラーはバックオフして再試行する。
 * 同じホストへは最低 1 秒あける（Wikimedia / Overpass への配慮）。
 */
export function installPoliteFetch(ua = userAgent(), minIntervalMs = 1_000, retries = 3): void {
  const raw = globalThis.fetch.bind(globalThis)
  const last = new Map<string, number>()
  globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const headers = new Headers(init.headers)
    headers.set('User-Agent', ua)
    headers.set('Api-User-Agent', ua)
    for (let attempt = 0; ; attempt++) {
      const wait = (last.get(url.host) ?? 0) + minIntervalMs - Date.now()
      if (wait > 0) await sleep(wait)
      last.set(url.host, Date.now())
      try {
        const res = await raw(input, { ...init, headers })
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          const ra = Number(res.headers.get('Retry-After'))
          const backoff = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) * 1000 : 10_000 * 2 ** attempt
          log(`HTTP ${res.status} from ${url.host}; retry in ${Math.round(backoff / 1000)}s`)
          await sleep(backoff)
          continue
        }
        return res
      } catch (e) {
        if (init.signal?.aborted || attempt >= retries) throw e
        log(`network error from ${url.host} (${String(e)}); retry`)
        await sleep(10_000 * 2 ** attempt)
      }
    }
  }
}

/** Overpass に 1 クエリ。エンドポイントを順に試す（各エンドポイント内の 429/5xx 再試行は politeFetch） */
async function overpass<T>(query: string, timeoutMs: number): Promise<T> {
  let lastError: unknown
  for (const ep of BUILD_OVERPASS_ENDPOINTS) {
    try {
      const json = await fetchJson<T & OverpassResponse>(
        ep,
        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: query }).toString() },
        { timeoutMs },
      )
      checkOverpassRemark(json)
      return json
    } catch (e) {
      lastError = e
      log(`overpass: ${ep} failed: ${e instanceof HttpError ? e.message : String(e)}`)
    }
  }
  throw lastError ?? new Error('all Overpass endpoints failed')
}

async function wikidata(): Promise<WikidataItem[]> {
  let lastError: unknown
  for (const transitive of [true, false]) {
    try {
      log(`wikidata: SPARQL (${transitive ? 'P31/P279*' : 'P31 only'})`)
      const json = await fetchJson<SparqlJson>(
        WIKIDATA_SPARQL_ENDPOINT,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
          body: new URLSearchParams({ query: buildWikidataSparql(transitive) }).toString(),
        },
        { timeoutMs: 90_000 },
      )
      const items = parseWikidataBindings(json)
      log(`wikidata: ${json.results?.bindings?.length ?? 0} rows → ${items.length} items`)
      if (items.length === 0) throw new Error('0 items')
      return items
    } catch (e) {
      lastError = e
      log(`wikidata: failed: ${String(e)}`)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Wikidata SPARQL failed')
}

/** GitHub Actions のジョブサマリーと警告注釈 */
function writeSummary(index: StaticIndex, written: string, problems: string[]): void {
  for (const w of index.warnings ?? []) console.log(`::warning title=build-poi::${w}`)
  const path = process.env.GITHUB_STEP_SUMMARY
  if (!path) return
  const lines = [
    '## Tokyo POI data',
    '',
    `- 結果: ${problems.length ? '**健全性チェック失敗（公開しない）**' : written}`,
    `- OSM: ${index.osm?.source ?? '?'}${index.osm?.timestamp ? `（${index.osm.timestamp} 時点）` : ''}`,
    `- 件数: ${index.count} / タイル ${Object.keys(index.tiles).length} 枚 / ${(index.bytes / 1024 / 1024).toFixed(2)} MiB（minify）`,
    `- version: ${index.version}`,
    ...problems.map((p) => `- ❌ ${p}`),
    ...(index.warnings ?? []).map((w) => `- ⚠️ ${w}`),
    '',
    '```json',
    JSON.stringify(index.stats, null, 1),
    '```',
    '',
  ]
  appendFileSync(path, lines.join('\n'))
}

const readJson = <T>(path: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

/** fixture の写真（ファイル名 → PhotoInfo）。近傍検索は無し */
function fixturePhotoSource(map: Record<string, PhotoInfo>): PhotoSource {
  return {
    async imageInfo(titles, width) {
      return new Map(titles.map((t) => [t, map[t] ? { ...map[t], url: map[t].url.replace(/\/\d+px-/, `/${width}px-`) } : null]))
    },
    async nearby() {
      return null
    },
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string', default: 'public/data/tokyo' },
      fixture: { type: 'string' },
      pbf: { type: 'string' },
      'work-dir': { type: 'string', default: '.cache/osm/work' },
      'osm-source': { type: 'string', default: 'auto' },
      sample: { type: 'boolean', default: false },
      'min-count': { type: 'string' },
      'nearby-limit': { type: 'string' },
      'no-photos': { type: 'boolean', default: false },
      'allow-shrink': { type: 'boolean', default: false },
    },
  })
  const outDir = values.out!
  const workDir = values['work-dir']!
  const started = Date.now()
  let elements: OverpassElement[]
  let wd: WikidataItem[]
  let boundaryWays: GeomWay[] | undefined
  let coverage: StaticCoverage | undefined
  let photos: PhotoSource | undefined
  let warnings: string[] = []
  let warnStats: Record<string, number> = {}
  let osm: StaticIndex['osm']
  if (values.fixture) {
    const dir = values.fixture
    wd = parseWikidataBindings(readJson<SparqlJson>(join(dir, 'wikidata.json')) ?? {})
    coverage = readJson<StaticCoverage>(join(dir, 'coverage.json'))
    const pm = readJson<Record<string, PhotoInfo>>(join(dir, 'photos.json'))
    photos = values['no-photos'] || !pm ? undefined : fixturePhotoSource(pm)
    if (values.pbf) {
      // fixture でも OSM 部分は osmium で（.osm の XML も読める）
      elements = await poiElementsFromPbf(values.pbf, { workDir, log })
      boundaryWays = await boundaryWaysFromPbf(values.pbf, { workDir })
    } else {
      elements = readJson<OverpassResponse>(join(dir, 'overpass.json'))?.elements ?? []
      boundaryWays = readJson<{ elements: GeomWay[] }>(join(dir, 'boundary.json'))?.elements
    }
    osm = { source: 'fixture' }
    log(`fixture: ${dir}`)
  } else {
    installPoliteFetch()
    const mode = values['osm-source'] as OsmSourceMode
    if (!['auto', 'geofabrik', 'overpass'].includes(mode)) throw new Error(`--osm-source must be auto|geofabrik|overpass: ${mode}`)
    const got = await acquire({
      pbf: values.pbf,
      mode,
      osmium: {
        available: () => osmiumAvailable(),
        poi: (pbf) => poiElementsFromPbf(pbf, { workDir, log }),
        boundary: (pbf) => boundaryWaysFromPbf(pbf, { workDir }),
        timestamp: (pbf) => pbfTimestamp(pbf),
      },
      overpass: (q) => overpass<OverpassResponse>(q, (OVERPASS_GRID_TIMEOUT_S + 30) * 1000),
      overpassBoundary: async () => (await overpass<{ elements: GeomWay[] }>(buildBoundaryQuery(), 180_000)).elements,
      wikidata,
      log,
    })
    ;({ elements, boundaryWays, warnings, warnStats, osm } = got)
    wd = got.wikidata
    photos = values['no-photos'] ? undefined : commonsPhotoSource
  }
  const { index, tiles } = await buildDataset({
    overpassElements: elements,
    wikidata: wd,
    boundaryWays,
    coverage,
    photos,
    nearbyLimit: values.fixture ? 0 : Number(values['nearby-limit'] ?? DEFAULT_NEARBY_LIMIT),
    generatedAt: new Date().toISOString(),
    sample: values.sample,
    warnings,
    warnStats,
    osm,
    log,
  })
  const prev = readPrevIndex(outDir)
  const minCount = Number(values['min-count'] ?? (values.fixture ? 1 : DEFAULT_MIN_COUNT))
  const problems = sanityCheck(index, { minCount, prev: values['allow-shrink'] ? null : prev })
  log(`result: ${index.count} places in ${Object.keys(index.tiles).length} tiles, ${(index.bytes / 1024).toFixed(1)} KiB (tiles, minified)`)
  log(`stats: ${JSON.stringify(index.stats)}`)
  for (const w of index.warnings ?? []) log(`WARNING: ${w}`)
  if (problems.length) {
    for (const p of problems) console.error(`[build-poi] SANITY CHECK FAILED: ${p}`)
    writeSummary(index, '', problems)
    process.exit(2)
  }
  if (prev && !prev.sample && prev.version === index.version && !!prev.sample === !!index.sample) {
    log(`no changes (version ${index.version}); nothing written`)
    writeSummary(index, `変更なし（version ${index.version}）`, [])
    return
  }
  const w = writeOutput(outDir, tiles, index)
  const secs = ((Date.now() - started) / 1000).toFixed(0)
  log(`node peak RSS ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MiB`)
  log(`wrote ${w.files} files, ${(w.bytes / 1024).toFixed(1)} KiB total → ${outDir} (version ${index.version}, ${secs}s)`)
  writeSummary(index, `書き出し ${w.files} ファイル・${(w.bytes / 1024 / 1024).toFixed(2)} MiB（${secs} 秒）`, [])
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build-poi/main.ts')) {
  main().catch((e) => {
    console.error('[build-poi] FAILED', e)
    process.exit(1)
  })
}
