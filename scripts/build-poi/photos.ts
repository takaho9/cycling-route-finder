/**
 * 写真の事前解決: Wikidata P18 / OSM wikimedia_commons・image（Commons のみ）→ Commons imageinfo（幅 500 / 960、作者、ライセンス）。
 * Commons の近傍検索は任意（公園・展望・寺社・史跡のみ、上限件数つき）。
 * 実際の通信は src/lib/photos.ts の関数を再利用する（User-Agent は main.ts で付与）。
 */
import {
  commonsFileFromTags,
  commonsNearbyOrThrow,
  fetchCommonsImageInfo,
  NEARBY_PHOTO_CATEGORIES,
  PHOTO_WIDTH_DETAIL,
  PHOTO_WIDTH_LIST,
  type PhotoInfo,
} from '../../src/lib/photos'
import type { EmbeddedPhoto } from '../../src/lib/types'
import type { PoiDraft } from './merge'

export interface PhotoSource {
  /** 取得に失敗したバッチのファイル名は結果の Map に入らない（null = 写真なし と区別する） */
  imageInfo(titles: readonly string[], width: number): Promise<Map<string, PhotoInfo | null>>
  /** 通信失敗は throw */
  nearby(p: { lat: number; lng: number; name: string }, width: number): Promise<PhotoInfo | null>
}

export const commonsPhotoSource: PhotoSource = {
  imageInfo: (titles, width) => fetchCommonsImageInfo(titles, width, { timeoutMs: 30_000 }),
  nearby: (p, width) => commonsNearbyOrThrow(p, width, { timeoutMs: 30_000 }),
}

/** 近傍検索がこの回数続けて失敗したら打ち切る（Commons が落ちているときに数百回叩かない） */
export const NEARBY_MAX_CONSECUTIVE_ERRORS = 5

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
  /** imageinfo を取れなかったファイル数（通信失敗。写真なしで続行） */
  infoFailed: number
  nearbyTried: number
  nearbyFound: number
  nearbyErrors: number
  /** 連続失敗で近傍検索を打ち切った */
  nearbyAborted: boolean
}

async function safeInfo(source: PhotoSource, titles: string[], width: number, log: (m: string) => void) {
  try {
    return await source.imageInfo(titles, width)
  } catch (e) {
    log(`photos: imageinfo (${width}px) failed: ${String(e)}`)
    return new Map<string, PhotoInfo | null>()
  }
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
  const small = titles.length ? await safeInfo(source, titles, PHOTO_WIDTH_LIST, log) : new Map<string, PhotoInfo | null>()
  const large = titles.length ? await safeInfo(source, titles, PHOTO_WIDTH_DETAIL, log) : new Map<string, PhotoInfo | null>()
  const infoFailed = titles.filter((t) => !small.has(t)).length
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
  let nearbyErrors = 0
  let streak = 0
  let nearbyTried = 0
  let nearbyAborted = false
  for (const d of candidates) {
    if (streak >= NEARBY_MAX_CONSECUTIVE_ERRORS) {
      nearbyAborted = true
      log(`photos: nearby search stopped after ${streak} consecutive errors`)
      break
    }
    nearbyTried++
    let info: PhotoInfo | null
    try {
      info = await source.nearby({ lat: d.lat, lng: d.lng, name: d.name }, PHOTO_WIDTH_LIST)
      streak = 0
    } catch {
      nearbyErrors++
      streak++
      continue
    }
    if (!info) continue
    d.photo = toEmbed(info, null, true)
    nearbyFound++
  }
  if (candidates.length) log(`photos: nearby ${nearbyFound}/${nearbyTried} (errors ${nearbyErrors})`)
  if (infoFailed) log(`photos: imageinfo failed for ${infoFailed}/${titles.length} files`)
  return { titles: titles.length, resolved, infoFailed, nearbyTried, nearbyFound, nearbyErrors, nearbyAborted }
}
