import { fetchJson, type RequestOptions } from './http'
import type { Place } from './types'

export const PHOTO_WIDTH = 800

/** Commons のファイル名 → 縮小画像 URL（Special:FilePath はリダイレクトで実体を返す） */
export function commonsFilePathUrl(fileName: string, width = PHOTO_WIDTH): string {
  const name = fileName
    .trim()
    .replace(/^(File|Image|ファイル|画像):/i, '')
    .replace(/ /g, '_')
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${width}`
}

/** OSM の image タグを URL に。Commons のファイル参照や http も扱う。使えなければ null */
export function imageTagToUrl(image: string | undefined, width = PHOTO_WIDTH): string | null {
  if (!image) return null
  const v = image.trim().split(';')[0].trim()
  if (/^(File|Image):/i.test(v)) return commonsFilePathUrl(v, width)
  // commons.wikimedia.org/wiki/File:xxx 形式のページ URL
  const m = v.match(/^https?:\/\/commons\.wikimedia\.org\/wiki\/(File:.+)$/i)
  if (m) return commonsFilePathUrl(decodeURIComponent(m[1]), width)
  if (/^https:\/\//i.test(v)) return v
  if (/^http:\/\//i.test(v)) return v.replace(/^http:/i, 'https:') // mixed content 回避（https 非対応ならブラウザ側で失敗→UI フォールバック）
  return null
}

/** wikimedia_commons タグ（File: のみ対応。Category: は画像を特定できないので null） */
export function commonsTagToUrl(tag: string | undefined, width = PHOTO_WIDTH): string | null {
  if (!tag) return null
  const v = tag.trim().split(';')[0].trim()
  return /^File:/i.test(v) ? commonsFilePathUrl(v, width) : null
}

interface WikidataEntityResponse {
  entities?: Record<
    string,
    { claims?: { P18?: { mainsnak?: { datavalue?: { value?: unknown } } }[] } }
  >
}

const wikidataCache = new Map<string, string | null>()
export function clearPhotoCache(): void {
  wikidataCache.clear()
}

/** Wikidata の P18 (image) → Commons URL。失敗・未設定なら null */
export async function fetchWikidataImageUrl(
  qid: string,
  { signal, timeoutMs = 8_000, width = PHOTO_WIDTH }: RequestOptions & { width?: number } = {},
): Promise<string | null> {
  const id = qid.trim().toUpperCase()
  if (!/^Q\d+$/.test(id)) return null
  if (wikidataCache.has(id)) return wikidataCache.get(id) ?? null
  try {
    const json = await fetchJson<WikidataEntityResponse>(
      `https://www.wikidata.org/wiki/Special:EntityData/${id}.json`,
      undefined,
      { signal, timeoutMs },
    )
    // リダイレクトされた entity の場合キーが異なることがあるので最初の entity を使う
    const entity = json.entities?.[id] ?? Object.values(json.entities ?? {})[0]
    const file = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
    const url = typeof file === 'string' && file ? commonsFilePathUrl(file, width) : null
    wikidataCache.set(id, url)
    return url
  } catch {
    // abort/timeout はキャッシュしない（後で再試行できるように）
    return null
  }
}

/**
 * Place の画像 URL を解決。
 * 明示の photoUrl → OSM image → wikimedia_commons → wikidata P18 → null（UI 側でカテゴリ別フォールバック）
 */
export async function resolvePhotoUrl(
  place: Pick<Place, 'photoUrl' | 'tags'>,
  opts: RequestOptions & { width?: number } = {},
): Promise<string | null> {
  if (place.photoUrl) return place.photoUrl
  const tags = place.tags ?? {}
  const width = opts.width ?? PHOTO_WIDTH
  const direct = imageTagToUrl(tags.image, width) ?? commonsTagToUrl(tags.wikimedia_commons, width)
  if (direct) return direct
  if (tags.wikidata) return fetchWikidataImageUrl(tags.wikidata.split(';')[0], opts)
  return null
}
