/**
 * 事前生成した都内データ（public/data/tokyo, v1.3）の形式。
 * 生成スクリプト（scripts/build-poi）とアプリ（./static.ts）の両方から使う唯一の定義。
 *
 * - index.json: タイル一覧・件数・生成日時・データ源・対象範囲
 * - t_<lat100>_<lng100>.json: 0.05° グリッドのタイル（キーは南西端の緯度経度 × 100）
 * フィールド名は短くしてある（minify 前提）。
 */
import { bearingDeg, haversineKm } from '../geo'
import type { Category, EmbeddedPhoto, LatLng, Place } from '../types'

/** タイルの大きさ (度)。0.05° ≈ 緯度 5.6km / 経度 4.5km（北緯 35.7°） */
export const TILE_DEG = 0.05
export const STATIC_FORMAT_VERSION = 1

/** 写真（短縮形）: m=幅500, l=幅960, a=作者, c=ライセンス, g=ファイルページ, n=1 なら付近の写真 */
export interface StaticPhoto {
  m: string
  l: string
  a?: string
  c?: string
  g?: string
  n?: 1
}

/** 1 件（短縮形） */
export interface StaticRecord {
  /** id（"osm:way/123" / "wd:Q123"） */
  i: string
  /** 名前 */
  n: string
  /** 緯度・経度（小数 5 桁 ≈ 1m） */
  y: number
  x: number
  /** カテゴリ */
  c: Category
  /** 見栄えスコア（小数 1 桁） */
  s: number
  /** 残すタグ（wikidata / heritage / size_m / opening_hours など） */
  t?: Record<string, string>
  /** Wikidata の sitelinks 数（人気度の代理指標） */
  w?: number
  /** 埋め込み写真 */
  p?: StaticPhoto
}

export interface StaticTile {
  v: number
  /** タイルキー */
  k: string
  p: StaticRecord[]
}

export interface StaticSource {
  name: string
  license: string
  url: string
}

export interface StaticCoverage {
  /** [south, west, north, east] */
  bbox: [number, number, number, number]
  /** 対象範囲のポリゴン（[lat, lng] のリング群, even-odd）。あればこれで判定 */
  rings?: [number, number][][]
  /** ポリゴンが無いときの代替: 対象範囲に含まれるタイルキー */
  cells?: string[]
}

export interface StaticIndex {
  v: number
  /** タイル URL のキャッシュ破り（?v=） */
  version: string
  /** 生成日時 (ISO 8601) */
  generatedAt: string
  /** true = 手元の fixture から作った小さなサンプル（網羅性なし。アプリはデモ扱いで表示） */
  sample?: boolean
  /** 対象地域の表示名 */
  region: string
  grid: number
  count: number
  /** タイル合計バイト数 */
  bytes: number
  /** タイルキー → 件数（0 件のタイルは無い） */
  tiles: Record<string, number>
  coverage: StaticCoverage
  sources: StaticSource[]
  /** カテゴリ別件数・写真件数など（ログ・確認用）。warn_* は警告 */
  stats?: Record<string, number>
  /** 生成時の警告（Wikidata / Commons の失敗、OSM の取得経路のフォールバックなど） */
  warnings?: string[]
  /** OSM データの出どころと時点 */
  osm?: { source: 'geofabrik' | 'overpass' | 'fixture'; timestamp?: string }
}

const EPS = 1e-9

/** 点が属するタイルのキー（"3565_13975"） */
export function tileKey(p: LatLng): string {
  const iy = Math.floor(p.lat / TILE_DEG + EPS)
  const ix = Math.floor(p.lng / TILE_DEG + EPS)
  return `${iy * 5}_${ix * 5}`
}

export function tileFileName(key: string): string {
  return `t_${key}.json`
}

/** タイルキー → 範囲 */
export function tileBounds(key: string): { s: number; w: number; n: number; e: number } {
  const [a, b] = key.split('_').map(Number)
  const s = a / 100
  const w = b / 100
  return { s, w, n: s + TILE_DEG, e: w + TILE_DEG }
}

/** 中心から半径 radiusKm の円にかかるタイルのキー（円とタイルの最短距離で判定） */
export function tilesForCircle(center: LatLng, radiusKm: number): string[] {
  const dLat = radiusKm / 111.32
  const dLng = radiusKm / (111.32 * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)))
  const y0 = Math.floor((center.lat - dLat) / TILE_DEG + EPS)
  const y1 = Math.floor((center.lat + dLat) / TILE_DEG + EPS)
  const x0 = Math.floor((center.lng - dLng) / TILE_DEG + EPS)
  const x1 = Math.floor((center.lng + dLng) / TILE_DEG + EPS)
  const out: string[] = []
  for (let iy = y0; iy <= y1; iy++) {
    for (let ix = x0; ix <= x1; ix++) {
      const s = iy * TILE_DEG
      const w = ix * TILE_DEG
      const nearest = {
        lat: Math.min(Math.max(center.lat, s), s + TILE_DEG),
        lng: Math.min(Math.max(center.lng, w), w + TILE_DEG),
      }
      if (haversineKm(center, nearest) <= radiusKm) out.push(`${iy * 5}_${ix * 5}`)
    }
  }
  return out
}

/** 点がリング群の内側か（even-odd。リングは [lat, lng] の配列） */
export function pointInRings(p: LatLng, rings: readonly (readonly (readonly [number, number])[])[]): boolean {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i]
      const [yj, xj] = ring[j]
      if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

/** 出発地が対象範囲（都内）にあるか */
export function inCoverage(index: Pick<StaticIndex, 'coverage'>, p: LatLng): boolean {
  const c = index.coverage
  const [s, w, n, e] = c.bbox
  if (p.lat < s || p.lat > n || p.lng < w || p.lng > e) return false
  if (c.rings?.length) return pointInRings(p, c.rings)
  if (c.cells) return c.cells.includes(tileKey(p))
  return true
}

/**
 * 検索円のうち対象範囲の外にある割合（0〜1, v1.4 Q10）。円を格子点で近似する（n×n）。
 * 都境の近くで「都外は一部のみ」と表示するのに使う。
 */
export function outsideCoverageRatio(index: Pick<StaticIndex, 'coverage'>, center: LatLng, radiusKm: number, n = 24): number {
  const dLat = radiusKm / 111.32
  const dLng = radiusKm / (111.32 * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)))
  let inside = 0
  let outside = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p = { lat: center.lat - dLat + ((i + 0.5) * 2 * dLat) / n, lng: center.lng - dLng + ((j + 0.5) * 2 * dLng) / n }
      if (haversineKm(center, p) > radiusKm) continue
      if (inCoverage(index, p)) inside++
      else outside++
    }
  }
  return inside + outside ? outside / (inside + outside) : 0
}

export function photoFromStatic(p: StaticPhoto): EmbeddedPhoto {
  return {
    url500: p.m,
    url960: p.l,
    ...(p.a ? { artist: p.a } : {}),
    ...(p.c ? { license: p.c } : {}),
    ...(p.g ? { pageUrl: p.g } : {}),
    ...(p.n ? { nearby: true } : {}),
  }
}

export function photoToStatic(p: EmbeddedPhoto): StaticPhoto {
  return {
    m: p.url500,
    l: p.url960,
    ...(p.artist ? { a: p.artist } : {}),
    ...(p.license ? { c: p.license } : {}),
    ...(p.pageUrl ? { g: p.pageUrl } : {}),
    ...(p.nearby ? { n: 1 as const } : {}),
  }
}

/** 短縮形 → Place（距離・方位は center から計算） */
export function recordToPlace(r: StaticRecord, center: LatLng): Place {
  const pos = { lat: r.y, lng: r.x }
  const tags: Record<string, string> = { ...(r.t ?? {}), name: r.n }
  if (r.w) tags.sitelinks = String(r.w)
  return {
    id: r.i,
    name: r.n,
    lat: r.y,
    lng: r.x,
    category: r.c,
    distanceKm: haversineKm(center, pos),
    bearing: bearingDeg(center, pos),
    tags,
    score: r.s,
    ...(r.p ? { photoEmbed: photoFromStatic(r.p) } : {}),
    source: 'static',
  }
}
