/** Wikidata SPARQL（取得 B）: 東京都内の観光的な項目（座標・日本語ラベル・P18・sitelinks） */
import { fileTitleFromFilePath } from '../../src/lib/photos'
import type { Category } from '../../src/lib/types'
import { MAINLAND_BBOX, WIKIDATA_CLASSES, WIKIDATA_TOKYO } from './config'

export interface WikidataItem {
  qid: string
  label: string
  lat: number
  lng: number
  /** "File:xxx.jpg"（P18） */
  image?: string
  sitelinks: number
  /** ホワイトリストで最初に当たったクラス */
  classQid: string
  category: Category
  /** P1435（文化財指定など）あり */
  heritage: boolean
}

/**
 * transitive = true: P31/P279*（サブクラスも拾う。重いのでタイムアウトしたら false で再実行）
 * 範囲: P131* で東京都配下 かつ 本土の bbox 内（島しょ部を除く）
 */
export function buildWikidataSparql(transitive = true): string {
  const roots = WIKIDATA_CLASSES.map((c) => `wd:${c.qid}`).join(' ')
  const [s, w, n, e] = MAINLAND_BBOX
  return `SELECT ?item ?label ?coord ?image ?sitelinks ?root ?heritage WHERE {
  VALUES ?root { ${roots} }
  ?item wdt:P131* wd:${WIKIDATA_TOKYO} .
  ?item wdt:P31${transitive ? '/wdt:P279*' : ''} ?root .
  ?item wdt:P625 ?coord .
  ?item wikibase:sitelinks ?sitelinks .
  ?item rdfs:label ?label . FILTER(LANG(?label) = "ja")
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?item wdt:P1435 ?heritage }
  FILTER NOT EXISTS { ?item wdt:P576 ?ended }
  BIND(geof:latitude(?coord) AS ?lat)
  BIND(geof:longitude(?coord) AS ?lng)
  FILTER(?lat >= ${s} && ?lat <= ${n} && ?lng >= ${w} && ?lng <= ${e})
}`
}

interface Binding {
  [k: string]: { value?: string } | undefined
}
export interface SparqlJson {
  results?: { bindings?: Binding[] }
}

/** "Point(139.76 35.68)" → {lat, lng} */
export function parseWktPoint(v: string | undefined): { lat: number; lng: number } | null {
  const m = v && /Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(v)
  if (!m) return null
  const lng = Number(m[1])
  const lat = Number(m[2])
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}

/** SPARQL の行（項目×画像×クラス×文化財の組み合わせ）を項目ごとにまとめる */
export function parseWikidataBindings(json: SparqlJson): WikidataItem[] {
  const priority = new Map(WIKIDATA_CLASSES.map((c, i) => [c.qid, i]))
  const byQid = new Map<string, WikidataItem>()
  for (const b of json.results?.bindings ?? []) {
    const qid = b.item?.value?.split('/').pop()
    const label = b.label?.value?.trim()
    const pos = parseWktPoint(b.coord?.value)
    const root = b.root?.value?.split('/').pop()
    if (!qid || !/^Q\d+$/.test(qid) || !label || !pos || !root || !priority.has(root)) continue
    const image = b.image?.value ? (fileTitleFromFilePath(b.image.value) ?? undefined) : undefined
    const prev = byQid.get(qid)
    if (!prev) {
      const cls = WIKIDATA_CLASSES[priority.get(root)!]
      byQid.set(qid, {
        qid,
        label,
        lat: pos.lat,
        lng: pos.lng,
        ...(image ? { image } : {}),
        sitelinks: Number(b.sitelinks?.value ?? 0) || 0,
        classQid: cls.qid,
        category: cls.category,
        heritage: !!b.heritage?.value,
      })
      continue
    }
    if (!prev.image && image) prev.image = image
    if (b.heritage?.value) prev.heritage = true
    if (priority.get(root)! < priority.get(prev.classQid)!) {
      prev.classQid = root
      prev.category = WIKIDATA_CLASSES[priority.get(root)!].category
    }
  }
  return [...byQid.values()].sort((a, b) => Number(a.qid.slice(1)) - Number(b.qid.slice(1)))
}
