import { fetchJson, isAbortError, mapWithConcurrency, type RequestOptions } from './http'
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

/** wikidata QID 群 → P18 ファイル名（最大 50 件/リクエストでバッチ, BACKLOG Y5） */
export async function fetchWikidataP18(qids: readonly string[], opts: RequestOptions = {}): Promise<Map<string, string | null>> {
  const ids = [...new Set(qids.map((q) => q.trim().toUpperCase()).filter((q) => /^Q\d+$/.test(q)))]
  const out = new Map<string, string | null>()
  for (let i = 0; i < ids.length; i += WIKI_BATCH) {
    const chunk = ids.slice(i, i + WIKI_BATCH)
    const url = `${WIKIDATA_API}?action=wbgetentities&ids=${chunk.join('|')}&props=claims&format=json&origin=*`
    try {
      const json = await fetchJson<WbEntities>(url, undefined, { timeoutMs: 8_000, ...opts })
      for (const q of chunk) {
        const v = json.entities?.[q]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
        out.set(q, typeof v === 'string' && v ? normalizeFileTitle(v) : null)
      }
    } catch (e) {
      if (opts.signal?.aborted) throw e
      if (!isAbortError(e)) console.warn('[photos] wikidata failed', e)
    }
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
  const url =
    `${COMMONS_API}?action=query&generator=geosearch&ggscoord=${p.lat.toFixed(5)}%7C${p.lng.toFixed(5)}` +
    `&ggsradius=${NEARBY_RADIUS_M}&ggsnamespace=6&ggslimit=10&${IMAGEINFO_PARAMS}&iiurlwidth=${width}`
  try {
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
  } catch (e) {
    if (opts.signal?.aborted) throw e
    return null
  }
}

const cache = new Map<string, PhotoInfo | null>()
export function clearPhotoCache(): void {
  cache.clear()
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
  const todo = places.filter((p) => {
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

  const titleOf = new Map<string, string>()
  for (const p of todo) {
    const t = commonsFileFromTags(p.tags)
    if (t) titleOf.set(p.id, t)
  }
  const needWd = todo.filter((p) => !titleOf.has(p.id) && p.tags?.wikidata)
  if (needWd.length) {
    const p18 = await fetchWikidataP18(
      needWd.map((p) => p.tags!.wikidata!.split(';')[0]),
      opts,
    )
    for (const p of needWd) {
      const t = p18.get(p.tags!.wikidata!.split(';')[0].trim().toUpperCase())
      if (t) titleOf.set(p.id, t)
    }
  }
  const infos = titleOf.size ? await fetchCommonsImageInfo([...titleOf.values()], width, opts) : new Map()
  for (const p of todo) {
    const t = titleOf.get(p.id)
    const info = t ? (infos.get(t) ?? null) : null
    if (info) out.set(p.id, info)
  }
  const rest = todo.filter((p) => !out.get(p.id) && p.category && NEARBY_PHOTO_CATEGORIES.has(p.category))
  if (nearby && rest.length) {
    await mapWithConcurrency(rest, NEARBY_CONCURRENCY, async (p) => {
      out.set(p.id, await fetchCommonsNearby(p, width, opts))
    })
  }
  for (const p of todo) {
    if (!out.has(p.id)) out.set(p.id, null)
    cache.set(ck(p.id), out.get(p.id) ?? null)
  }
  return out
}
