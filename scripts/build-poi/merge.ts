/**
 * 統合（OSM × Wikidata）・重複除去・見栄えスコア。
 * OSM 側のカテゴリ判定・ノイズ除外は src/lib/places/overpass.ts をそのまま再利用する。
 */
import { haversineKm } from '../../src/lib/geo'
import { parseOverpassElements, type OverpassElement } from '../../src/lib/places/overpass'
import { attractiveness, dedupeNearby } from '../../src/lib/places/sampling'
import type { Category, EmbeddedPhoto } from '../../src/lib/types'
import { MAINLAND_MIN_LAT, MATCH_RADIUS_M, TOKYO_STATION, WD_ONLY_MIN_SITELINKS, WD_ONLY_MIN_SITELINKS_BRIDGE } from './config'
import type { WikidataItem } from './wikidata'

/** 生成途中の 1 件 */
export interface PoiDraft {
  id: string
  name: string
  lat: number
  lng: number
  category: Category
  tags: Record<string, string>
  sitelinks?: number
  /** Wikidata の P1435（文化財指定など） */
  wdHeritage?: boolean
  /** Wikidata P18 のファイル名（"File:..."） */
  p18?: string
  photo?: EmbeddedPhoto
  score?: number
}

/** OSM 要素 → 下書き（島しょ部を除外） */
export function osmToDrafts(elements: readonly OverpassElement[]): PoiDraft[] {
  return parseOverpassElements(elements, TOKYO_STATION)
    .filter((p) => p.lat >= MAINLAND_MIN_LAT)
    .map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, category: p.category, tags: { ...(p.tags ?? {}) } }))
}

const PAREN_RE = /[（(［[][^）)］\]]*[）)］\]]/g
const PUNCT_RE = /[\s・･·\-‐－―〜~'"’”「」『』〈〉【】,，.。、]/g
const AFFIX_RE = /^(都立|区立|市立|町立|国営|国立|旧)|(公園|庭園|緑地|神社|神宮|寺|院|美術館|博物館|記念館|展望台|城跡|城址|跡|橋)$/g

export function normalizeName(s: string): string {
  return s.normalize('NFKC').replace(PAREN_RE, '').replace(PUNCT_RE, '').toLowerCase()
}

/** 同名 or 類似名（片方がもう片方を含む／一般名詞を除いた核が一致） */
export function similarName(a: string, b: string): boolean {
  const x = normalizeName(a)
  const y = normalizeName(b)
  if (!x || !y) return false
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if (short.length >= 3 && long.includes(short)) return true
  const cx = x.replace(AFFIX_RE, '')
  const cy = y.replace(AFFIX_RE, '')
  return cx.length >= 2 && cx === cy
}

const firstQid = (v: string | undefined) => {
  const q = v?.split(';')[0].trim().toUpperCase()
  return q && /^Q\d+$/.test(q) ? q : undefined
}

/** 約 200m のグリッドで近傍を引く */
class GridIndex<T extends { lat: number; lng: number }> {
  private cells = new Map<string, T[]>()
  constructor(private readonly deg = 0.002) {}
  private k(lat: number, lng: number) {
    return `${Math.floor(lat / this.deg)}:${Math.floor(lng / this.deg)}`
  }
  add(item: T) {
    const k = this.k(item.lat, item.lng)
    const arr = this.cells.get(k)
    if (arr) arr.push(item)
    else this.cells.set(k, [item])
  }
  near(lat: number, lng: number): T[] {
    const cy = Math.floor(lat / this.deg)
    const cx = Math.floor(lng / this.deg)
    const out: T[] = []
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) out.push(...(this.cells.get(`${y}:${x}`) ?? []))
    return out
  }
}

export interface MergeStats {
  osm: number
  wikidata: number
  matchedByTag: number
  matchedByName: number
  wikidataOnly: number
  droppedWikidataOnly: number
}

function applyWikidata(d: PoiDraft, w: WikidataItem) {
  d.tags.wikidata = w.qid
  d.sitelinks = w.sitelinks
  if (w.heritage) d.wdHeritage = true
  if (w.image) d.p18 = w.image
  if (d.category === 'other') d.category = w.category
}

/**
 * OSM と Wikidata を突き合わせる。
 * 1. OSM の wikidata タグが一致
 * 2. タグが無い OSM 要素と「同名 or 類似名 かつ 150m 以内」（最も近いもの。1 対 1）
 * 3. どれにも当たらない Wikidata 項目は、sitelinks がしきい値以上なら単独で採用（id "wd:Q..."）
 */
export function mergeSources(osm: readonly PoiDraft[], wd: readonly WikidataItem[]): { pois: PoiDraft[]; stats: MergeStats } {
  const pois = osm.map((d) => ({ ...d, tags: { ...d.tags } }))
  const stats: MergeStats = { osm: osm.length, wikidata: wd.length, matchedByTag: 0, matchedByName: 0, wikidataOnly: 0, droppedWikidataOnly: 0 }
  const wdById = new Map(wd.map((w) => [w.qid, w]))
  const matched = new Set<string>()
  for (const d of pois) {
    const q = firstQid(d.tags.wikidata)
    const w = q ? wdById.get(q) : undefined
    if (!w) continue
    applyWikidata(d, w)
    if (!matched.has(w.qid)) stats.matchedByTag++
    matched.add(w.qid)
  }
  const untagged = new GridIndex<PoiDraft>()
  for (const d of pois) if (!d.tags.wikidata) untagged.add(d)
  const taken = new Set<string>()
  // 有名なものから順に割り当てる
  const rest = wd.filter((w) => !matched.has(w.qid)).sort((a, b) => b.sitelinks - a.sitelinks || Number(a.qid.slice(1)) - Number(b.qid.slice(1)))
  for (const w of rest) {
    let best: PoiDraft | null = null
    let bestM = Infinity
    for (const d of untagged.near(w.lat, w.lng)) {
      if (taken.has(d.id)) continue
      const m = haversineKm(d, w) * 1000
      if (m <= MATCH_RADIUS_M && m < bestM && similarName(d.name, w.label)) {
        best = d
        bestM = m
      }
    }
    if (best) {
      taken.add(best.id)
      applyWikidata(best, w)
      matched.add(w.qid)
      stats.matchedByName++
      continue
    }
    const min = w.classQid === 'Q12280' ? WD_ONLY_MIN_SITELINKS_BRIDGE : WD_ONLY_MIN_SITELINKS
    if (w.sitelinks < min || w.lat < MAINLAND_MIN_LAT) {
      stats.droppedWikidataOnly++
      continue
    }
    stats.wikidataOnly++
    pois.push({
      id: `wd:${w.qid}`,
      name: w.label,
      lat: w.lat,
      lng: w.lng,
      category: w.category,
      tags: { wikidata: w.qid },
      sitelinks: w.sitelinks,
      ...(w.heritage ? { wdHeritage: true } : {}),
      ...(w.image ? { p18: w.image } : {}),
    })
  }
  return { pois, stats }
}

const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * 見栄えスコア（事前計算）。既存の attractiveness（wikidata・commons/image・heritage・wikipedia・面積）に
 * sitelinks（人気度）、写真の有無、Wikidata 側の文化財指定を加える。
 */
export function appealScore(d: Pick<PoiDraft, 'tags' | 'sitelinks' | 'photo' | 'p18' | 'wdHeritage'>): number {
  let s = attractiveness({ tags: d.tags })
  if (d.sitelinks && d.sitelinks > 0) s += Math.min(4, Math.log2(1 + d.sitelinks))
  if (d.photo) s += d.photo.nearby ? 1 : 2
  else if (d.p18) s += 1
  if (d.wdHeritage && !d.tags.heritage) s += 2
  return round1(s)
}

/**
 * 重複除去: 同じ wikidata を持つものは 1 件（スコア最大）に、さらに「同名かつ 300m 以内」を 1 件に。
 * score が入っている前提（dedupeNearby は score を見栄えスコアとして使う）。
 */
export function dedupePois(pois: readonly PoiDraft[]): PoiDraft[] {
  const byQid = new Map<string, PoiDraft>()
  const noQid: PoiDraft[] = []
  const better = (a: PoiDraft, b: PoiDraft) => (a.score ?? 0) > (b.score ?? 0) || ((a.score ?? 0) === (b.score ?? 0) && a.id < b.id)
  for (const d of pois) {
    const q = firstQid(d.tags.wikidata)
    if (!q) {
      noQid.push(d)
      continue
    }
    const prev = byQid.get(q)
    if (!prev || better(d, prev)) byQid.set(q, d)
  }
  return dedupeNearby([...byQid.values(), ...noQid]).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
