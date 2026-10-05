/**
 * 写真の事前解決: Wikidata P18 / OSM wikimedia_commons・image（Commons のみ）→ Commons imageinfo（幅 500 / 960、作者、ライセンス）。
 * Commons の近傍検索は任意（公園・展望・寺社・史跡のみ、上限件数つき）。
 * 実際の通信は src/lib/photos.ts の関数を再利用する（User-Agent は main.ts で付与）。
 */
import {
  commonsFileFromTags,
  fetchCommonsImageInfo,
  fetchCommonsNearby,
  NEARBY_PHOTO_CATEGORIES,
  PHOTO_WIDTH_DETAIL,
  PHOTO_WIDTH_LIST,
  type PhotoInfo,
} from '../../src/lib/photos'
import type { EmbeddedPhoto } from '../../src/lib/types'
import type { PoiDraft } from './merge'

export interface PhotoSource {
  imageInfo(titles: readonly string[], width: number): Promise<Map<string, PhotoInfo | null>>
  nearby(p: { lat: number; lng: number; name: string }, width: number): Promise<PhotoInfo | null>
}

export const commonsPhotoSource: PhotoSource = {
  imageInfo: (titles, width) => fetchCommonsImageInfo(titles, width, { timeoutMs: 30_000 }),
  nearby: (p, width) => fetchCommonsNearby(p, width, { timeoutMs: 30_000 }),
}

/** 500px のサムネ URL から 960px 版を作る（Commons のサムネ URL 規則 ".../thumb/.../500px-Name"） */
export function widerThumb(url: string, width = PHOTO_WIDTH_DETAIL): string {
  return url.replace(/\/(\d+)px-([^/]+)$/, (_m, _w, rest: string) => `/${width}px-${rest}`)
}

const toEmbed = (small: PhotoInfo, large: PhotoInfo | null | undefined, nearby = false): EmbeddedPhoto => ({
  url500: small.url,
  url960: large?.url ?? widerThumb(small.url),
  ...(small.artist ? { artist: small.artist } : {}),
  ...(small.license ? { license: small.license } : {}),
  ...(small.pageUrl ? { pageUrl: small.pageUrl } : {}),
  ...(nearby ? { nearby: true } : {}),
})

export interface PhotoStats {
  titles: number
  resolved: number
  nearbyTried: number
  nearbyFound: number
}

/** pois[].photo を埋める（破壊的） */
export async function attachPhotos(
  pois: PoiDraft[],
  source: PhotoSource,
  { nearbyLimit = 0, log = () => {} }: { nearbyLimit?: number; log?: (msg: string) => void } = {},
): Promise<PhotoStats> {
  const titleOf = new Map<string, string>()
  for (const d of pois) {
    const t = commonsFileFromTags(d.tags) ?? d.p18
    if (t) titleOf.set(d.id, t)
  }
  const titles = [...new Set(titleOf.values())]
  log(`photos: resolving ${titles.length} Commons files (imageinfo ×2 widths)`)
  const small = titles.length ? await source.imageInfo(titles, PHOTO_WIDTH_LIST) : new Map<string, PhotoInfo | null>()
  const large = titles.length ? await source.imageInfo(titles, PHOTO_WIDTH_DETAIL) : new Map<string, PhotoInfo | null>()
  let resolved = 0
  for (const d of pois) {
    const t = titleOf.get(d.id)
    const s = t ? small.get(t) : null
    if (!s) continue
    d.photo = toEmbed(s, large.get(t!))
    resolved++
  }
  // 近傍検索: 写真の無い公園・展望・寺社・史跡を、スコアの高い順に上限まで
  const candidates = pois
    .filter((d) => !d.photo && NEARBY_PHOTO_CATEGORIES.has(d.category))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.id < b.id ? -1 : 1))
    .slice(0, Math.max(0, nearbyLimit))
  let nearbyFound = 0
  for (const d of candidates) {
    const info = await source.nearby({ lat: d.lat, lng: d.lng, name: d.name }, PHOTO_WIDTH_LIST)
    if (!info) continue
    d.photo = toEmbed(info, null, true)
    nearbyFound++
  }
  if (candidates.length) log(`photos: nearby ${nearbyFound}/${candidates.length}`)
  return { titles: titles.length, resolved, nearbyTried: candidates.length, nearbyFound }
}
