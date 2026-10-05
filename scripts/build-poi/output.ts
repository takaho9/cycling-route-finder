/** タイル分割・index.json・健全性チェック・書き出し */
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  photoToStatic,
  STATIC_FORMAT_VERSION,
  TILE_DEG,
  tileFileName,
  tileKey,
  type StaticCoverage,
  type StaticIndex,
  type StaticRecord,
  type StaticTile,
} from '../../src/lib/places/staticData'
import { DATA_SOURCES, MAX_SHRINK_RATIO, REGION_NAME } from './config'
import type { PoiDraft } from './merge'

/** 静的データに残すタグ（アプリが使うものだけ。写真を埋め込んだら画像タグは不要） */
/** v1.4 Q5: 営業時間・公式サイト・料理の種類も残す（カフェなどの加点と、将来の表示用） */
const STATIC_TAGS = ['wikidata', 'heritage', 'size_m', 'opening_hours', 'website', 'cuisine'] as const
const IMAGE_TAGS = ['wikimedia_commons', 'image'] as const

const r5 = (v: number) => Math.round(v * 1e5) / 1e5

export function toRecord(d: PoiDraft): StaticRecord {
  const t: Record<string, string> = {}
  for (const k of STATIC_TAGS) if (d.tags[k]) t[k] = d.tags[k]
  if (!d.photo) for (const k of IMAGE_TAGS) if (d.tags[k]) t[k] = d.tags[k]
  return {
    i: d.id,
    n: d.name,
    y: r5(d.lat),
    x: r5(d.lng),
    c: d.category,
    s: d.score ?? 0,
    ...(Object.keys(t).length ? { t } : {}),
    ...(d.sitelinks ? { w: d.sitelinks } : {}),
    ...(d.photo ? { p: photoToStatic(d.photo) } : {}),
  }
}

/** 0.05° グリッドに分割（各タイル内はスコア降順 → id 昇順で決定的） */
export function buildTiles(pois: readonly PoiDraft[]): Map<string, StaticTile> {
  const groups = new Map<string, StaticRecord[]>()
  for (const d of pois) {
    const k = tileKey(d)
    const arr = groups.get(k) ?? []
    arr.push(toRecord(d))
    groups.set(k, arr)
  }
  const out = new Map<string, StaticTile>()
  for (const k of [...groups.keys()].sort()) {
    const p = groups.get(k)!.sort((a, b) => b.s - a.s || (a.i < b.i ? -1 : a.i > b.i ? 1 : 0))
    out.set(k, { v: STATIC_FORMAT_VERSION, k, p })
  }
  return out
}

export function serializeTile(t: StaticTile): string {
  return JSON.stringify(t)
}

export interface BuildIndexInput {
  tiles: Map<string, StaticTile>
  coverage: StaticCoverage
  generatedAt: string
  sample?: boolean
  stats?: Record<string, number>
  warnings?: string[]
  osm?: StaticIndex['osm']
}

export function buildIndex({ tiles, coverage, generatedAt, sample, stats, warnings, osm }: BuildIndexInput): StaticIndex {
  const hash = createHash('sha1')
  const counts: Record<string, number> = {}
  let bytes = 0
  let count = 0
  for (const [k, t] of tiles) {
    const s = serializeTile(t)
    hash.update(s)
    bytes += Buffer.byteLength(s)
    count += t.p.length
    counts[k] = t.p.length
  }
  hash.update(JSON.stringify(coverage))
  return {
    v: STATIC_FORMAT_VERSION,
    version: hash.digest('hex').slice(0, 12),
    generatedAt,
    ...(sample ? { sample: true } : {}),
    region: REGION_NAME,
    grid: TILE_DEG,
    count,
    bytes,
    tiles: counts,
    coverage,
    sources: DATA_SOURCES,
    ...(stats ? { stats } : {}),
    ...(warnings?.length ? { warnings } : {}),
    ...(osm ? { osm } : {}),
  }
}

export interface SanityOptions {
  minCount: number
  /** 前回の index（無ければ初回）。サンプルデータは比較対象にしない */
  prev?: Pick<StaticIndex, 'count' | 'sample'> | null
  maxShrinkRatio?: number
}

/** 取得失敗で空・激減データを公開しないためのチェック。問題があればメッセージを返す（空なら OK） */
export function sanityCheck(index: Pick<StaticIndex, 'count' | 'tiles'>, { minCount, prev, maxShrinkRatio = MAX_SHRINK_RATIO }: SanityOptions): string[] {
  const problems: string[] = []
  if (index.count < minCount) problems.push(`件数が少なすぎます: ${index.count} < 最低 ${minCount}`)
  if (Object.keys(index.tiles).length === 0) problems.push('タイルが 0 個です')
  if (prev && !prev.sample && prev.count > 0) {
    const ratio = (prev.count - index.count) / prev.count
    if (ratio >= maxShrinkRatio) {
      problems.push(`前回比 ${(ratio * 100).toFixed(1)}% 減（${prev.count} → ${index.count}）。しきい値 ${(maxShrinkRatio * 100).toFixed(0)}%`)
    }
  }
  return problems
}

export function readPrevIndex(dir: string): StaticIndex | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as StaticIndex
  } catch {
    return null
  }
}

/** タイルと index.json を書き出し、今回無くなったタイルを消す。index は最後に書く */
export function writeOutput(dir: string, tiles: Map<string, StaticTile>, index: StaticIndex): { files: number; bytes: number } {
  mkdirSync(dir, { recursive: true })
  const keep = new Set<string>(['index.json'])
  let bytes = 0
  for (const [k, t] of tiles) {
    const name = tileFileName(k)
    const s = serializeTile(t)
    writeFileSync(join(dir, name), s)
    bytes += Buffer.byteLength(s)
    keep.add(name)
  }
  for (const f of readdirSync(dir)) if (/^t_.*\.json$/.test(f) && !keep.has(f)) rmSync(join(dir, f))
  const idx = JSON.stringify(index)
  writeFileSync(join(dir, 'index.json'), idx)
  bytes += Buffer.byteLength(idx)
  return { files: tiles.size + 1, bytes }
}
