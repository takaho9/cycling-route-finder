/**
 * 都内の目的地データを事前生成して public/data/tokyo/ に書き出す（v1.3）。
 *
 *   本番（GitHub Actions）: npx tsx scripts/build-poi/main.ts
 *   fixture から:           npx tsx scripts/build-poi/main.ts --fixture scripts/build-poi/fixtures/sample --sample
 *
 * オプション:
 *   --out <dir>          出力先（既定 public/data/tokyo）
 *   --fixture <dir>      通信せず fixture を使う（overpass.json / wikidata.json / [boundary.json] / [coverage.json] / [photos.json]）
 *   --sample             index.json に "sample": true を入れる（網羅性の無いサンプル）
 *   --min-count <n>      最低件数（既定: 本番 3000 / fixture 1）
 *   --nearby-limit <n>   Commons 近傍検索の上限（既定 300。0 で無効）
 *   --no-photos          写真の解決をしない
 *   --allow-shrink       前回比の減少チェックを無効にする（意図的に減らすときだけ）
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { fetchJson, HttpError, sleep } from '../../src/lib/http'
import { buildOverpassAreaQuery, checkOverpassRemark, type OverpassResponse } from '../../src/lib/places/overpass'
import type { PhotoInfo } from '../../src/lib/photos'
import type { StaticCoverage } from '../../src/lib/places/staticData'
import { buildBoundaryQuery, type GeomWay } from './boundary'
import { buildDataset } from './build'
import {
  BUILD_OVERPASS_ENDPOINTS,
  DEFAULT_MIN_COUNT,
  DEFAULT_NEARBY_LIMIT,
  OVERPASS_AREA_FILTER,
  OVERPASS_TIMEOUT_S,
  userAgent,
  WIKIDATA_SPARQL_ENDPOINT,
} from './config'
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

async function overpass<T>(query: string, timeoutMs: number): Promise<T> {
  let lastError: unknown
  for (const ep of BUILD_OVERPASS_ENDPOINTS) {
    try {
      log(`overpass: POST ${ep}`)
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
      return items
    } catch (e) {
      log(`wikidata: failed: ${String(e)}`)
    }
  }
  throw new Error('Wikidata SPARQL failed')
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
      sample: { type: 'boolean', default: false },
      'min-count': { type: 'string' },
      'nearby-limit': { type: 'string' },
      'no-photos': { type: 'boolean', default: false },
      'allow-shrink': { type: 'boolean', default: false },
    },
  })
  const outDir = values.out!
  const started = Date.now()
  let elements: OverpassResponse['elements']
  let wd: WikidataItem[]
  let boundaryWays: GeomWay[] | undefined
  let coverage: StaticCoverage | undefined
  let photos: PhotoSource | undefined
  if (values.fixture) {
    const dir = values.fixture
    elements = readJson<OverpassResponse>(join(dir, 'overpass.json'))?.elements ?? []
    wd = parseWikidataBindings(readJson<SparqlJson>(join(dir, 'wikidata.json')) ?? {})
    boundaryWays = readJson<{ elements: GeomWay[] }>(join(dir, 'boundary.json'))?.elements
    coverage = readJson<StaticCoverage>(join(dir, 'coverage.json'))
    const pm = readJson<Record<string, PhotoInfo>>(join(dir, 'photos.json'))
    photos = values['no-photos'] || !pm ? undefined : fixturePhotoSource(pm)
    log(`fixture: ${dir}`)
  } else {
    installPoliteFetch()
    const q = buildOverpassAreaQuery(OVERPASS_AREA_FILTER, OVERPASS_TIMEOUT_S)
    elements = (await overpass<OverpassResponse>(q, (OVERPASS_TIMEOUT_S + 60) * 1000)).elements ?? []
    if (elements.length === 0) throw new Error('Overpass returned 0 elements')
    wd = await wikidata()
    try {
      boundaryWays = (await overpass<{ elements: GeomWay[] }>(buildBoundaryQuery(), 180_000)).elements
    } catch (e) {
      log(`boundary: failed (${String(e)}); fall back to POI cells`)
    }
    photos = values['no-photos'] ? undefined : commonsPhotoSource
  }
  const { index, tiles } = await buildDataset({
    overpassElements: elements ?? [],
    wikidata: wd,
    boundaryWays,
    coverage,
    photos,
    nearbyLimit: values.fixture ? 0 : Number(values['nearby-limit'] ?? DEFAULT_NEARBY_LIMIT),
    generatedAt: new Date().toISOString(),
    sample: values.sample,
    log,
  })
  const prev = readPrevIndex(outDir)
  const minCount = Number(values['min-count'] ?? (values.fixture ? 1 : DEFAULT_MIN_COUNT))
  const problems = sanityCheck(index, { minCount, prev: values['allow-shrink'] ? null : prev })
  log(`result: ${index.count} places in ${Object.keys(index.tiles).length} tiles, ${(index.bytes / 1024).toFixed(1)} KiB (tiles, minified)`)
  log(`stats: ${JSON.stringify(index.stats)}`)
  if (problems.length) {
    for (const p of problems) console.error(`[build-poi] SANITY CHECK FAILED: ${p}`)
    process.exit(2)
  }
  if (prev && !prev.sample && prev.version === index.version && !!prev.sample === !!index.sample) {
    log(`no changes (version ${index.version}); nothing written`)
    return
  }
  const w = writeOutput(outDir, tiles, index)
  log(`wrote ${w.files} files, ${(w.bytes / 1024).toFixed(1)} KiB total → ${outDir} (version ${index.version}, ${((Date.now() - started) / 1000).toFixed(0)}s)`)
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build-poi/main.ts')) {
  main().catch((e) => {
    console.error('[build-poi] FAILED', e)
    process.exit(1)
  })
}
