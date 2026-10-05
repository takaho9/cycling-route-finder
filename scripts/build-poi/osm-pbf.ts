/**
 * OSM の主経路（v1.3.1）: Geofabrik の抽出 PBF ＋ osmium-tool。
 *
 *   1. osmium extract     … 都内本土の bbox で切り出す（-s smart: multipolygon を完全に）
 *   2. osmium tags-filter … 既存の Overpass セレクタ（OVERPASS_SELECTORS）の主タグに絞る
 *   3. osmium export      … GeoJSON Seq（1 行 1 Feature）
 *   4. Node で読み、セレクタの残りの条件（name・religion・brand 等）を同じ定義で判定し、
 *      Overpass と同じ形（node は座標、way/relation は中心点、公園は bbox）に変換して
 *      既存の categorize / isWorthVisiting / 統合ロジックに流す。
 *
 * 東京都の境界も同じ PBF から取る（ISO3166-2=JP-13、または admin_level=4 かつ name=東京都）。
 * PBF 全体をメモリに載せない（osmium はストリーム処理、Node は 1 行ずつ読む）。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { OVERPASS_SELECTORS, type OverpassElement, type Selector } from '../../src/lib/places/overpass'
import type { GeomWay } from './boundary'
import { MAINLAND_BBOX } from './config'

// ---------------------------------------------------------------------------
// セレクタ（Overpass QL のタグ条件）を JS の述語にする
// ---------------------------------------------------------------------------

type Cond = { neg: boolean; key: string; op?: '=' | '!=' | '~' | '!~'; value?: string; re?: RegExp }

const COND_RE = /\[(!?)"([^"]+)"(?:(=|!=|~|!~)"([^"]*)")?\]/g

/** `["k"="v"]["k2"~"re"][!"k3"]["k4"!~"re"]` → 条件の配列 */
export function parseSelectorFilter(filter: string): Cond[] {
  const out: Cond[] = []
  for (const m of filter.matchAll(COND_RE)) {
    const [, neg, key, op, value] = m
    out.push({
      neg: neg === '!',
      key,
      ...(op ? { op: op as Cond['op'], value } : {}),
      ...(op === '~' || op === '!~' ? { re: new RegExp(value) } : {}),
    })
  }
  return out
}

/** Overpass と同じ意味で判定（!= と !~ はキーが無くても真） */
export function condMatches(c: Cond, tags: Record<string, string>): boolean {
  const v = tags[c.key]
  if (c.neg) return v === undefined
  if (!c.op) return v !== undefined
  switch (c.op) {
    case '=':
      return v === c.value
    case '!=':
      return v !== c.value
    case '~':
      return v !== undefined && c.re!.test(v)
    case '!~':
      return v === undefined || !c.re!.test(v)
  }
}

type OsmType = 'node' | 'way' | 'relation'
const PARSED = OVERPASS_SELECTORS.map((s) => ({ s, conds: parseSelectorFilter(s.filter) }))

/** どれかのセレクタに当たるか。park = 公園セレクタ（Overpass では bbox を出していた）に当たったか */
export function matchSelectors(type: OsmType, tags: Record<string, string>): { matched: boolean; park: boolean } {
  let matched = false
  let park = false
  for (const { s, conds } of PARSED) {
    const kindOk = type === 'node' ? s.kinds.includes('node') : s.kinds.includes('area') || s.kinds.includes('park')
    if (!kindOk || !conds.every((c) => condMatches(c, tags))) continue
    matched = true
    if (type !== 'node' && s.kinds.includes('park')) park = true
  }
  return { matched, park }
}

/** 主タグの値: `="v"` → [v]、`~"^(a|b)$"` → [a, b] */
function primaryValues(c: Cond): string[] {
  if (c.op === '=') return [c.value!]
  if (c.op === '~') {
    const m = /^\^\(?([^()]*?)\)?\$$/.exec(c.value!)
    if (m && /^[\w|:]+$/.test(m[1])) return m[1].split('|')
  }
  throw new Error(`cannot derive an osmium tags-filter from ${JSON.stringify(c)}`)
}

/**
 * osmium tags-filter の式（各セレクタの最初の条件 = 主タグ。残りの条件は Node 側で判定）。
 * 例: ["n/tourism=viewpoint", "wr/leisure=park,garden", ...]
 */
export function tagsFilterExpressions(selectors: readonly Selector[] = OVERPASS_SELECTORS): string[] {
  const acc = new Map<string, Set<string>>() // "n/key" → values
  for (const s of selectors) {
    const first = parseSelectorFilter(s.filter)[0]
    const values = primaryValues(first)
    const types = [s.kinds.includes('node') ? 'n' : '', s.kinds.some((k) => k !== 'node') ? 'wr' : ''].filter(Boolean)
    for (const t of types) {
      const k = `${t}/${first.key}`
      const set = acc.get(k) ?? new Set<string>()
      values.forEach((v) => set.add(v))
      acc.set(k, set)
    }
  }
  return [...acc].map(([k, vs]) => `${k}=${[...vs].join(',')}`).sort()
}

// ---------------------------------------------------------------------------
// GeoJSON Seq → Overpass 形式の要素
// ---------------------------------------------------------------------------

interface Feature {
  geometry?: { type: string; coordinates: unknown }
  properties?: Record<string, unknown>
}

function walkCoords(c: unknown, f: (lng: number, lat: number) => void): void {
  if (!Array.isArray(c)) return
  if (typeof c[0] === 'number' && typeof c[1] === 'number') return f(c[0], c[1])
  for (const x of c) walkCoords(x, f)
}

/** 1 Feature → 要素（セレクタに当たらなければ null） */
export function featureToElement(feature: Feature): OverpassElement | null {
  const props = feature.properties ?? {}
  const type = props['@type'] as OsmType | undefined
  const id = Number(props['@id'])
  if (!type || !Number.isFinite(id) || !feature.geometry) return null
  const tags: Record<string, string> = {}
  for (const [k, v] of Object.entries(props)) if (!k.startsWith('@') && typeof v === 'string') tags[k] = v
  const { matched, park } = matchSelectors(type, tags)
  if (!matched) return null
  let minlat = Infinity
  let minlon = Infinity
  let maxlat = -Infinity
  let maxlon = -Infinity
  walkCoords(feature.geometry.coordinates, (lng, lat) => {
    minlat = Math.min(minlat, lat)
    maxlat = Math.max(maxlat, lat)
    minlon = Math.min(minlon, lng)
    maxlon = Math.max(maxlon, lng)
  })
  if (!Number.isFinite(minlat)) return null
  if (type === 'node') return { type, id, lat: minlat, lon: minlon, tags }
  const r7 = (v: number) => Math.round(v * 1e7) / 1e7
  const extent = { minlat, minlon, maxlat, maxlon }
  // Overpass と同じ: 公園は bbox（規模判定用）、それ以外は中心点（bbox の中心）。extent は境内判定用（v1.3.2）
  if (park) return { type, id, bounds: { minlat, minlon, maxlat, maxlon }, tags, extent }
  return { type, id, center: { lat: r7((minlat + maxlat) / 2), lon: r7((minlon + maxlon) / 2) }, tags, extent }
}

/**
 * GeoJSON Seq の行を要素にする。osmium export は閉じた way を LineString と Polygon の両方で出すので
 * type/id で 1 件にする（どちらも bbox は同じ）。
 */
export function featuresToElements(lines: Iterable<string>): OverpassElement[] {
  const byId = new Map<string, OverpassElement>()
  for (const raw of lines) {
    const line = raw.replace(/^\x1e/, '').trim()
    if (!line) continue
    const el = featureToElement(JSON.parse(line) as Feature)
    if (!el) continue
    const k = `${el.type}/${el.id}`
    if (!byId.has(k)) byId.set(k, el)
  }
  return [...byId.values()]
}

async function readGeojsonSeq(path: string): Promise<OverpassElement[]> {
  const out = new Map<string, OverpassElement>()
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity })
  // 1 行ずつ変換し、ジオメトリは保持しない（メモリ節約）
  for await (const raw of rl) {
    const line = raw.replace(/^\x1e/, '').trim()
    if (!line) continue
    const el = featureToElement(JSON.parse(line) as Feature)
    if (el && !out.has(`${el.type}/${el.id}`)) out.set(`${el.type}/${el.id}`, el)
  }
  return [...out.values()]
}

// ---------------------------------------------------------------------------
// 境界（OPL）
// ---------------------------------------------------------------------------

/** OPL のエスケープ（%hex%）を戻す */
export function decodeOpl(s: string): string {
  return s.replace(/%([0-9a-fA-F]+)%/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
}

function oplTags(field: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!field) return out
  for (const kv of field.split(',')) {
    if (!kv) continue
    const i = kv.indexOf('=')
    if (i > 0) out[decodeOpl(kv.slice(0, i))] = decodeOpl(kv.slice(i + 1))
  }
  return out
}

/** 東京都の relation か */
export function isTokyoBoundary(tags: Record<string, string>): boolean {
  if (tags['ISO3166-2'] === 'JP-13') return true
  return tags.boundary === 'administrative' && tags.admin_level === '4' && tags.name === '東京都'
}

interface OplData {
  nodes: Map<number, { lat: number; lon: number }>
  ways: Map<number, number[]>
  rels: { id: number; tags: Record<string, string>; members: { type: string; ref: number; role: string }[] }[]
}

/** `osmium cat -f opl,add_metadata=false` の出力を読む（node 座標・way のノード列・relation のメンバー） */
export function parseOpl(opl: string): OplData {
  const nodes = new Map<number, { lat: number; lon: number }>()
  const ways = new Map<number, number[]>()
  const rels: OplData['rels'] = []
  for (const line of opl.split('\n')) {
    if (!line) continue
    const fields = new Map<string, string>()
    const parts = line.split(' ')
    for (const p of parts.slice(1)) if (p) fields.set(p[0], p.slice(1))
    const kind = line[0]
    const id = Number(parts[0].slice(1))
    if (kind === 'n') {
      const x = Number(fields.get('x'))
      const y = Number(fields.get('y'))
      if (fields.get('x') && fields.get('y') && Number.isFinite(x) && Number.isFinite(y)) nodes.set(id, { lat: y, lon: x })
    } else if (kind === 'w') {
      ways.set(id, (fields.get('N') ?? '').split(',').filter(Boolean).map((r) => Number(r.slice(1))))
    } else if (kind === 'r') {
      const members = (fields.get('M') ?? '')
        .split(',')
        .filter(Boolean)
        .map((m) => {
          const at = m.indexOf('@')
          return { type: m[0], ref: Number(m.slice(1, at)), role: decodeOpl(m.slice(at + 1)) }
        })
      rels.push({ id, tags: oplTags(fields.get('T')), members })
    }
  }
  return { nodes, ways, rels }
}

/** relation の outer ウェイを座標つきで（欠けたメンバーは飛ばす） */
function outerWays(data: OplData, rel: OplData['rels'][number]): GeomWay[] {
  const out: GeomWay[] = []
  for (const m of rel.members) {
    if (m.type !== 'w' || (m.role && m.role !== 'outer')) continue
    const refs = data.ways.get(m.ref)
    if (!refs) continue
    const geometry = refs.map((r) => data.nodes.get(r))
    if (geometry.some((g) => !g)) continue
    out.push({ type: 'way', id: m.ref, geometry: geometry as { lat: number; lon: number }[] })
  }
  return out
}

/**
 * 東京都 relation の outer ウェイを座標つきで返す。
 * 抽出範囲外で欠けたメンバー（遠い島など）は飛ばす（リングを組むときに閉じないので捨てられる）。
 */
export function boundaryWaysFromOpl(opl: string): GeomWay[] {
  const data = parseOpl(opl)
  const rel = data.rels.find((r) => r.tags['ISO3166-2'] === 'JP-13') ?? data.rels.find((r) => isTokyoBoundary(r.tags))
  return rel ? outerWays(data, rel) : []
}

/** 市区町村（admin_level=7）の名前と outer ウェイ（v1.4 Q1: 汎用名に「（江東区）」を補う） */
export function municipalitiesFromOpl(opl: string): { name: string; ways: GeomWay[] }[] {
  const data = parseOpl(opl)
  return data.rels
    .filter((r) => r.tags.boundary === 'administrative' && r.tags.admin_level === '7' && (r.tags['name:ja'] ?? r.tags.name))
    .map((r) => ({ name: r.tags['name:ja'] ?? r.tags.name, ways: outerWays(data, r) }))
    .filter((m) => m.ways.length)
}

// ---------------------------------------------------------------------------
// osmium の実行
// ---------------------------------------------------------------------------

export function osmiumAvailable(bin = 'osmium'): boolean {
  try {
    return spawnSync(bin, ['--version'], { encoding: 'utf8' }).status === 0
  } catch {
    return false
  }
}

function run(bin: string, args: string[], capture = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'] })
    const chunks: Buffer[] = []
    p.stdout?.on('data', (c: Buffer) => chunks.push(c))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error(`${bin} ${args[0]} exited with ${code}`))))
  })
}

export interface OsmiumOptions {
  bin?: string
  workDir: string
  /** [s, w, n, e] */
  bbox?: readonly [number, number, number, number]
  log?: (msg: string) => void
}

/** PBF（または .osm）→ 都内本土 bbox の POI 要素（Overpass 形式） */
export async function poiElementsFromPbf(input: string, { bin = 'osmium', workDir, bbox = MAINLAND_BBOX, log = () => {} }: OsmiumOptions): Promise<OverpassElement[]> {
  mkdirSync(workDir, { recursive: true })
  const [s, w, n, e] = bbox
  const cut = join(workDir, 'tokyo-bbox.osm.pbf')
  const poi = join(workDir, 'tokyo-poi.osm.pbf')
  const seq = join(workDir, 'tokyo-poi.geojsonseq')
  let t = Date.now()
  await run(bin, ['extract', '-b', `${w},${s},${e},${n}`, '-s', 'smart', input, '-o', cut, '--overwrite'])
  log(`osmium extract: ${((Date.now() - t) / 1000).toFixed(1)}s`)
  t = Date.now()
  const exprs = tagsFilterExpressions()
  await run(bin, ['tags-filter', cut, ...exprs, '-o', poi, '--overwrite'])
  log(`osmium tags-filter (${exprs.length} expressions): ${((Date.now() - t) / 1000).toFixed(1)}s`)
  t = Date.now()
  await run(bin, ['export', poi, '-f', 'geojsonseq', '-x', 'print_record_separator=false', '-a', 'type,id', '-o', seq, '--overwrite'])
  log(`osmium export: ${((Date.now() - t) / 1000).toFixed(1)}s`)
  const elements = await readGeojsonSeq(seq)
  log(`osm (pbf): ${elements.length} elements match the selectors`)
  return elements
}

/** PBF（または .osm）→ 東京都の境界ウェイ */
export async function boundaryWaysFromPbf(input: string, { bin = 'osmium', workDir }: OsmiumOptions): Promise<GeomWay[]> {
  mkdirSync(workDir, { recursive: true })
  const out = join(workDir, 'tokyo-boundary.osm.pbf')
  await run(bin, ['tags-filter', input, 'r/ISO3166-2=JP-13', 'r/name=東京都', '-o', out, '--overwrite'])
  const opl = await run(bin, ['cat', out, '-f', 'opl,add_metadata=false'], true)
  return boundaryWaysFromOpl(opl)
}

/** PBF（または .osm）→ 市区町村（admin_level=7）。bbox で切った後のファイルがあればそれを使う */
export async function municipalitiesFromPbf(input: string, { bin = 'osmium', workDir }: OsmiumOptions): Promise<{ name: string; ways: GeomWay[] }[]> {
  mkdirSync(workDir, { recursive: true })
  const out = join(workDir, 'municipalities.osm.pbf')
  await run(bin, ['tags-filter', input, 'r/admin_level=7', '-o', out, '--overwrite'])
  const opl = await run(bin, ['cat', out, '-f', 'opl,add_metadata=false'], true)
  return municipalitiesFromOpl(opl)
}

/** PBF のレプリケーション時刻（Geofabrik のデータ時点）。無ければ undefined */
export async function pbfTimestamp(input: string, bin = 'osmium'): Promise<string | undefined> {
  try {
    const v = (await run(bin, ['fileinfo', '-g', 'header.option.osmosis_replication_timestamp', input], true)).trim()
    return v || undefined
  } catch {
    return undefined
  }
}
