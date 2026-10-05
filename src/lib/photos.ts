import { fetchJson, isAbortError, mapWithConcurrency, type RequestOptions } from './http'
import { createKvCache, type KvCache } from './kvCache'
import type { Category, Place } from './types'

/** サムネ幅（BACKLOG A4）: 一覧 / 詳細 */
export const PHOTO_WIDTH_LIST = 500
export const PHOTO_WIDTH_DETAIL = 960
/** Wikidata / Commons API の 1 リクエストあたり最大件数 */
export const WIKI_BATCH = 50
/** 近傍画像検索の半径 (m) */
export const NEARBY_RADIUS_M = 100
const NEARBY_CONCURRENCY = 4

export const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
/** Wikidata Query Service（CORS 可）。P18 だけを取る（BACKLOG-2 C15） */
export const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql'
export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'

export interface PhotoInfo {
  url: string
  /** 作者（HTML 除去済み） */
  artist?: string
  /** 例: "CC BY-SA 4.0" */
  license?: string
  /** Commons のファイルページ */
  pageUrl?: string
  /** true = 施設そのものの写真ではなく、近くで撮られた写真（「付近の写真」と表示, C11） */
  nearby?: boolean
}

/** 近傍写真をさがすカテゴリ（屋外で、付近の写真でも雰囲気が伝わるもの, BACKLOG-2 C11） */
export const NEARBY_PHOTO_CATEGORIES: ReadonlySet<Category> = new Set<Category>(['park', 'viewpoint', 'shrine', 'historic'])

/** 施設名から取り除く一般名詞（ファイル名との照合に使わない） */
const GENERIC_NAME_RE =
  /(公園|緑地|広場|庭園|神社|神宮|八幡宮|稲荷|天満宮|寺院|寺|院|堂|宮|社|展望台|展望広場|見晴らし台|城跡|城址|跡|遺跡|古墳|旧|の|park|garden|shrine|temple)/gi

/** 施設名の固有部分の 2 文字窓（ファイル名に含まれていれば、その施設の写真の可能性が高い） */
export function nameFragments(name: string): string[] {
  const core = name.normalize('NFKC').replace(/\s+/g, '').replace(GENERIC_NAME_RE, '').toLowerCase()
  if (core.length < 2) return []
  return [...new Set(Array.from({ length: core.length - 1 }, (_, i) => core.slice(i, i + 2)))]
}

/** ファイル名に施設名の一部（2 文字以上）が含まれるか */
export function titleMatchesName(title: string, name: string): boolean {
  const t = title.normalize('NFKC').replace(/[\s_]+/g, '').toLowerCase()
  return nameFragments(name).some((f) => t.includes(f))
}

const stripHtml = (s: string | undefined) =>
  s
    ?.replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim() || undefined

/** "Foo bar.jpg" / "File:Foo_bar.jpg" → "File:Foo bar.jpg"（MediaWiki のタイトル正規形） */
export function normalizeFileTitle(name: string): string {
  const n = name.trim().replace(/^(File|Image|ファイル|画像):/i, '').replace(/_/g, ' ')
  return `File:${n}`
}

/**
 * OSM の image / wikimedia_commons タグから Commons のファイル名を取り出す。
 * 任意ドメインの URL は使わない（BACKLOG A4/Y5: Commons のみ許可）。
 */
export function commonsFileFromTags(tags: Record<string, string> | undefined): string | null {
  if (!tags) return null
  const commons = tags.wikimedia_commons?.split(';')[0].trim()
  if (commons && /^File:/i.test(commons)) return normalizeFileTitle(commons)
  const image = tags.image?.split(';')[0].trim()
  if (!image) return null
  if (/^(File|Image):/i.test(image)) return normalizeFileTitle(image)
  const page = image.match(/^https?:\/\/commons\.(?:m\.)?wikimedia\.org\/wiki\/(File:[^?#]+)/i)
  if (page) return normalizeFileTitle(decodeURIComponent(page[1]))
  const upload = image.match(/^https?:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/i)
  if (upload) return normalizeFileTitle(decodeURIComponent(upload[1]))
  return null
}

interface WbEntities {
  entities?: Record<string, { claims?: { P18?: { mainsnak?: { datavalue?: { value?: unknown } } }[] } }>
}

interface SparqlResponse {
  results?: { bindings?: { item?: { value?: string }; image?: { value?: string } }[] }
}

/** SPARQL: 指定 QID の P18（画像）だけを返すクエリ */
export function buildP18Sparql(qids: readonly string[]): string {
  return `SELECT ?item ?image WHERE { VALUES ?item { ${qids.map((q) => `wd:${q}`).join(' ')} } ?item wdt:P18 ?image . }`
}

/** "http://commons.wikimedia.org/wiki/Special:FilePath/Foo%20bar.jpg" → "File:Foo bar.jpg" */
export function fileTitleFromFilePath(url: string): string | null {
  const m = /Special:FilePath\/([^?#]+)$/.exec(url)
  if (!m) return null
  try {
    return normalizeFileTitle(decodeURIComponent(m[1]))
  } catch {
    return null
  }
}

async function p18BySparql(chunk: readonly string[], opts: RequestOptions): Promise<Map<string, string | null>> {
  const url = `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(buildP18Sparql(chunk))}`
  const json = await fetchJson<SparqlResponse>(url, { headers: { Accept: 'application/sparql-results+json' } }, { timeoutMs: 8_000, ...opts })
  const out = new Map<string, string | null>(chunk.map((q) => [q, null]))
  for (const b of json.results?.bindings ?? []) {
    const q = b.item?.value?.split('/').pop()
    const t = b.image?.value ? fileTitleFromFilePath(b.image.value) : null
    if (q && t && out.get(q) === null) out.set(q, t)
  }
  return out
}

async function p18ByEntities(chunk: readonly string[], opts: RequestOptions): Promise<Map<string, string | null>> {
  const url = `${WIKIDATA_API}?action=wbgetentities&ids=${chunk.join('|')}&props=claims&format=json&origin=*`
  const json = await fetchJson<WbEntities>(url, undefined, { timeoutMs: 8_000, ...opts })
  const out = new Map<string, string | null>()
  for (const q of chunk) {
    const v = json.entities?.[q]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
    out.set(q, typeof v === 'string' && v ? normalizeFileTitle(v) : null)
  }
  return out
}

/**
 * wikidata QID 群 → P18 ファイル名（最大 50 件/リクエストでバッチ, BACKLOG Y5）。
 * SPARQL で P18 だけを取る（全 claims を返す wbgetentities より軽い, C15）。SPARQL が落ちていたら wbgetentities で代替。
 */
export async function fetchWikidataP18(qids: readonly string[], opts: RequestOptions = {}): Promise<Map<string, string | null>> {
  const ids = [...new Set(qids.map((q) => q.trim().toUpperCase()).filter((q) => /^Q\d+$/.test(q)))]
  const out = new Map<string, string | null>()
  for (let i = 0; i < ids.length; i += WIKI_BATCH) {
    const chunk = ids.slice(i, i + WIKI_BATCH)
    let got: Map<string, string | null> | null = null
    for (const source of [p18BySparql, p18ByEntities]) {
      try {
        got = await source(chunk, opts)
        break
      } catch (e) {
        if (opts.signal?.aborted) throw e
        if (!isAbortError(e)) console.warn('[photos] wikidata failed', e)
      }
    }
    got?.forEach((v, k) => out.set(k, v))
  }
  return out
}

interface ImageInfoPage {
  title?: string
  imageinfo?: {
    thumburl?: string
    url?: string
    descriptionurl?: string
    extmetadata?: Record<string, { value?: string }>
  }[]
}
interface ImageInfoResponse {
  query?: { normalized?: { from: string; to: string }[]; pages?: Record<string, ImageInfoPage> }
}

function toPhotoInfo(page: ImageInfoPage | undefined): PhotoInfo | null {
  const ii = page?.imageinfo?.[0]
  const url = ii?.thumburl ?? ii?.url
  if (!url || !/^https:\/\/upload\.wikimedia\.org\//.test(url)) return null
  if (!/\.(jpe?g|png|webp)(\/|$|\?)/i.test(url) && !/\.(jpe?g|png|webp)$/i.test(page?.title ?? '')) return null
  return {
    url,
    artist: stripHtml(ii?.extmetadata?.Artist?.value),
    license: stripHtml(ii?.extmetadata?.LicenseShortName?.value),
    pageUrl: ii?.descriptionurl,
  }
}

const IMAGEINFO_PARAMS = 'prop=imageinfo&iiprop=url|extmetadata&iiextmetadatafilter=Artist|LicenseShortName&format=json&origin=*'

/** ファイル名群 → サムネ URL＋作者・ライセンス（最大 50 件/リクエスト） */
export async function fetchCommonsImageInfo(
  titles: readonly string[],
  width: number,
  opts: RequestOptions = {},
): Promise<Map<string, PhotoInfo | null>> {
  const uniq = [...new Set(titles)]
  const out = new Map<string, PhotoInfo | null>()
  for (let i = 0; i < uniq.length; i += WIKI_BATCH) {
    const chunk = uniq.slice(i, i + WIKI_BATCH)
    const url = `${COMMONS_API}?action=query&titles=${encodeURIComponent(chunk.join('|'))}&${IMAGEINFO_PARAMS}&iiurlwidth=${width}`
    try {
      const json = await fetchJson<ImageInfoResponse>(url, undefined, { timeoutMs: 8_000, ...opts })
      const norm = new Map((json.query?.normalized ?? []).map((n) => [n.to, n.from]))
      const pages = Object.values(json.query?.pages ?? {})
      for (const t of chunk) out.set(t, null)
      for (const page of pages) {
        if (!page.title) continue
        const original = norm.get(page.title) ?? page.title
        out.set(original, toPhotoInfo(page))
        out.set(page.title, toPhotoInfo(page))
      }
    } catch (e) {
      if (opts.signal?.aborted) throw e
      if (!isAbortError(e)) console.warn('[photos] commons imageinfo failed', e)
    }
  }
  return out
}

/**
 * Commons の近傍画像検索（半径 100m, BACKLOG A4/C11）。
 * ファイル名に施設名の一部（2 文字以上）が含まれる写真を優先し、無ければ一番近い写真。結果には nearby=true を付ける。
 */
export async function fetchCommonsNearby(
  p: { lat: number; lng: number; name?: string },
  width: number,
  opts: RequestOptions = {},
): Promise<PhotoInfo | null> {
  try {
    return await commonsNearbyOrThrow(p, width, opts)
  } catch (e) {
    if (opts.signal?.aborted) throw e
    return null
  }
}

/** fetchCommonsNearby の本体。通信失敗は throw（「写真なし」と区別して永続化しないため） */
async function commonsNearbyOrThrow(
  p: { lat: number; lng: number; name?: string },
  width: number,
  opts: RequestOptions,
): Promise<PhotoInfo | null> {
  const url =
    `${COMMONS_API}?action=query&generator=geosearch&ggscoord=${p.lat.toFixed(5)}%7C${p.lng.toFixed(5)}` +
    `&ggsradius=${NEARBY_RADIUS_M}&ggsnamespace=6&ggslimit=10&${IMAGEINFO_PARAMS}&iiurlwidth=${width}`
  const json = await fetchJson<ImageInfoResponse & { query?: { pages?: Record<string, ImageInfoPage & { index?: number }> } }>(
    url,
    undefined,
    { timeoutMs: 8_000, ...opts },
  )
  const pages = Object.values(json.query?.pages ?? {}).sort(
    (a, b) => ((a as { index?: number }).index ?? 0) - ((b as { index?: number }).index ?? 0),
  )
  const usable = pages.map((page) => ({ page, info: toPhotoInfo(page) })).filter((x) => x.info)
  const named = p.name ? usable.find((x) => titleMatchesName(x.page.title ?? '', p.name!)) : undefined
  const chosen = named ?? usable[0]
  return chosen?.info ? { ...chosen.info, nearby: true } : null
}

const cache = new Map<string, PhotoInfo | null>()
/** メモリ層を消す（永続層は残す） */
export function clearPhotoCache(): void {
  cache.clear()
}

/** 永続キャッシュ（v1.2）: 写真あり 30 日、「写真なし」は 3 日（あとから写真が登録されることがあるので短め） */
export const PHOTO_PERSIST_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const PHOTO_NONE_PERSIST_TTL_MS = 3 * 24 * 60 * 60 * 1000
export const PHOTO_PERSIST_MAX = 2_000
let persistent: KvCache<PhotoInfo | null> | null | undefined

function photoStore(): KvCache<PhotoInfo | null> | null {
  return (persistent ??= createKvCache<PhotoInfo | null>({
    namespace: 'photo',
    ttlMs: PHOTO_PERSIST_TTL_MS,
    ttlFor: (v) => (v ? PHOTO_PERSIST_TTL_MS : PHOTO_NONE_PERSIST_TTL_MS),
    maxEntries: PHOTO_PERSIST_MAX,
    maxEntriesLocalStorage: 300,
  }))
}

/** テスト用: 永続層を差し替える（null = 永続層なし, undefined = 既定に戻す） */
export function setPhotoPersistentCache(c: KvCache<PhotoInfo | null> | null | undefined): void {
  persistent = c
}

export interface ResolvePhotosOptions extends RequestOptions {
  width?: number
  /** Commons 近傍検索を使うか（既定 true。公園・展望・寺社・史跡のみ, C11） */
  nearby?: boolean
}

/**
 * 複数の Place の写真をまとめて解決（BACKLOG A4/Y5）。
 * 明示 photoUrl → OSM wikimedia_commons/image(Commons のみ) → wikidata P18 → Commons 近傍（公園・展望・寺社・史跡のみ）→ null（UI でカテゴリ別フォールバック）
 * Wikidata / Commons はそれぞれ 50 件単位でバッチ、近傍検索は並列 4。
 */
export async function resolvePhotos(
  places: readonly (Pick<Place, 'id' | 'lat' | 'lng' | 'tags' | 'photoUrl'> & Partial<Pick<Place, 'name' | 'category'>>)[],
  { width = PHOTO_WIDTH_LIST, nearby = true, ...opts }: ResolvePhotosOptions = {},
): Promise<Map<string, PhotoInfo | null>> {
  const out = new Map<string, PhotoInfo | null>()
  const ck = (id: string) => `${width}|${id}`
  let todo = places.filter((p) => {
    if (p.photoUrl) {
      out.set(p.id, { url: p.photoUrl })
      return false
    }
    if (cache.has(ck(p.id))) {
      out.set(p.id, cache.get(ck(p.id)) ?? null)
      return false
    }
    return true
  })
  if (todo.length === 0) return out

  // メモリ → 永続（まとめて 1 回）→ ネットワーク
  const store = photoStore()
  if (store) {
    const hit = await store.getMany(todo.map((p) => ck(p.id)))
    if (opts.signal?.aborted) throw abortError()
    todo = todo.filter((p) => {
      if (!hit.has(ck(p.id))) return true
      const v = hit.get(ck(p.id)) ?? null
      cache.set(ck(p.id), v)
      out.set(p.id, v)
      return false
    })
    if (todo.length === 0) return out
  }

  /** 通信に失敗して「写真なし」と言い切れない place（永続化しない） */
  const uncertain = new Set<string>()
  const titleOf = new Map<string, string>()
  for (const p of todo) {
    const t = commonsFileFromTags(p.tags)
    if (t) titleOf.set(p.id, t)
  }
  const needWd = todo.filter((p) => !titleOf.has(p.id) && p.tags?.wikidata)
  if (needWd.length) {
    const qid = (p: (typeof needWd)[number]) => p.tags!.wikidata!.split(';')[0].trim().toUpperCase()
    const p18 = await fetchWikidataP18(
      needWd.map((p) => p.tags!.wikidata!.split(';')[0]),
      opts,
    )
    for (const p of needWd) {
      const t = p18.get(qid(p))
      if (t) titleOf.set(p.id, t)
      else if (!p18.has(qid(p)) && /^Q\d+$/.test(qid(p))) uncertain.add(p.id)
    }
  }
  const infos: Map<string, PhotoInfo | null> = titleOf.size ? await fetchCommonsImageInfo([...titleOf.values()], width, opts) : new Map()
  for (const p of todo) {
    const t = titleOf.get(p.id)
    if (t && !infos.has(t)) uncertain.add(p.id)
    const info = t ? (infos.get(t) ?? null) : null
    if (info) out.set(p.id, info)
  }
  const rest = todo.filter((p) => !out.get(p.id) && p.category && NEARBY_PHOTO_CATEGORIES.has(p.category))
  if (nearby && rest.length) {
    await mapWithConcurrency(rest, NEARBY_CONCURRENCY, async (p) => {
      try {
        out.set(p.id, await commonsNearbyOrThrow(p, width, opts))
      } catch (e) {
        if (opts.signal?.aborted) throw e
        out.set(p.id, null)
        uncertain.add(p.id)
      }
    })
  }
  const persist: [string, PhotoInfo | null][] = []
  for (const p of todo) {
    if (!out.has(p.id)) out.set(p.id, null)
    const v = out.get(p.id) ?? null
    cache.set(ck(p.id), v)
    if (v || !uncertain.has(p.id)) persist.push([ck(p.id), v])
  }
  // 書き込みは待たない（表示を遅らせない）
  if (store && persist.length) void store.setMany(persist)
  return out
}

function abortError(): Error {
  const e = new Error('The operation was aborted')
  e.name = 'AbortError'
  return e
}
