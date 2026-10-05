/**
 * 名前の付け直し（v1.4 BACKLOG-3 Q1）。
 * 汎用名・付属建物名・英語だけの名前は、Wikidata の日本語ラベルに置き換える。
 * ラベルで直らない汎用名（同名が多い名前を含む）は「八幡神社（江東区）」のように市区町村名で補う。
 * 付属建物名で直らなかったものは、wikidata があっても除外する。
 */
import { hasJapanese, isGenericName, isWorshipPartName, normalizeForMatch } from '../../src/lib/places/quality'
import type { LatLng } from '../../src/lib/types'
import type { PoiDraft } from './merge'

/** 都内にこの数以上ある同名（飲食以外）は「どこの」が分からないので市区町村名で補う */
export const REPEATED_NAME_MIN = 3

const FOOD = new Set(['cafe', 'bakery', 'sweets'])

export interface NamingStats {
  byLabel: number
  byCity: number
  droppedParts: number
}

export function applyNaming(
  pois: readonly PoiDraft[],
  { municipalityOf }: { municipalityOf?: (p: LatLng) => string | undefined } = {},
): { pois: PoiDraft[]; stats: NamingStats } {
  const stats: NamingStats = { byLabel: 0, byCity: 0, droppedParts: 0 }
  const counts = new Map<string, number>()
  for (const d of pois) if (!FOOD.has(d.category)) counts.set(normalizeForMatch(d.name), (counts.get(normalizeForMatch(d.name)) ?? 0) + 1)
  const out: PoiDraft[] = []
  for (const src of pois) {
    if (FOOD.has(src.category)) {
      out.push(src)
      continue
    }
    const d = { ...src }
    // wikidata のある項目は「建物の部分」の名前だけ（〜堂の名所は残す）
    const part = d.category === 'shrine' && isWorshipPartName(d.name, { strict: !!d.tags.wikidata })
    const repeated = (counts.get(normalizeForMatch(d.name)) ?? 0) >= REPEATED_NAME_MIN
    const generic = isGenericName(d.name) || repeated
    const english = !hasJapanese(d.name)
    const label = d.wdLabel?.trim()
    const labelUsable =
      !!label && normalizeForMatch(label) !== normalizeForMatch(d.name) && hasJapanese(label) && !isWorshipPartName(label) && !isGenericName(label)
    const longerLabel = !!label && label.includes(d.name) && label.length > d.name.length
    if (labelUsable && (part || generic || english || longerLabel)) {
      d.name = label!
      stats.byLabel++
    } else if (part) {
      stats.droppedParts++
      continue
    } else if (generic) {
      const city = municipalityOf?.(d)
      if (city && !d.name.includes(city)) {
        d.name = `${d.name}（${city}）`
        stats.byCity++
      }
    }
    out.push(d)
  }
  return { pois: out, stats }
}
