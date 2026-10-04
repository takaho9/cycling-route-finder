import { summarizeElevation } from '../elevation'
import { bearingDeg, destinationPoint, haversineKm, interpolateLine } from '../geo'
import { hashString, mulberry32, pick } from '../random'
import type { Category, LatLng, Place, PlaceProvider } from '../types'

export const MOCK_COUNT = 36

const PLACE_WORDS = [
  '桜ヶ丘', '若葉', '緑町', '富士見', '青葉台', '東山', '宮前', '鶴見', '柏木', '大宮', '松原', '梅ヶ丘',
  '白山', '朝日', '稲荷山', '鷹ノ台', '浜田', '萩原', '杉並木', '小松川', '水元', '城北', '千鳥', '北野',
  '石神', '光が丘', '高砂', '野川', '西原', '芦花', '舟渡', '本郷', '月見', '天神', '日向', '岩倉',
] as const

const KANA_WORDS = [
  'ハルノヒ', 'モリノネ', 'ソラマメ', 'コムギ', 'ツバメ', 'ミズタマ', 'アサヒ', 'キツツキ', 'ポラリス', 'リンデン',
] as const

const TEMPLATES: Record<Exclude<Category, 'other'>, readonly ((w: string, k: string) => string)[]> = {
  park: [(w) => `${w}公園`, (w) => `${w}緑地`, (w) => `${w}運動公園`, (w) => `${w}森林公園`, (w) => `${w}中央公園`],
  viewpoint: [(w) => `${w}展望台`, (w) => `${w}見晴らし台`, (w) => `${w}展望広場`, (w) => `${w}の丘`],
  cafe: [(w) => `${w}珈琲`, (_w, k) => `カフェ ${k}`, (w) => `${w}珈琲店`, (w) => `喫茶 ${w}`, (_w, k) => `${k} COFFEE`],
  bakery: [(_w, k) => `ベーカリー ${k}`, (w) => `${w}パン工房`, (_w, k) => `ブーランジェリー ${k}`, (w) => `${w}ベーカリー`],
  shrine: [(w) => `${w}神社`, (w) => `${w}寺`, (w) => `${w}八幡宮`, (w) => `${w}稲荷神社`, (w) => `${w}観音堂`],
  historic: [(w) => `${w}城跡`, (w) => `${w}古墳`, (w) => `旧${w}家住宅`, (w) => `${w}一里塚`, (w) => `${w}の関跡`],
  waterside: [(w) => `${w}川河川敷`, (w) => `${w}池`, (w) => `${w}親水公園`, (w) => `${w}海浜公園`, (w) => `${w}の水辺`],
  attraction: [(w) => `${w}庭園`, (w) => `${w}の滝`, (w) => `${w}郷土資料館`, (w) => `${w}の大銀杏`],
  roadside_station: [(w) => `道の駅 ${w}`],
}

const MOCK_CATEGORIES = Object.keys(TEMPLATES) as Exclude<Category, 'other'>[]

/**
 * なめらかな擬似地形 (m)。緯度経度だけで決まる決定的な関数。
 * 数 km スケールの起伏 + 広域の傾斜。
 */
export function mockTerrainElevation(p: LatLng): number {
  const x = p.lng * 111
  const y = p.lat * 111
  const v =
    20 +
    15 * Math.sin(x / 3.1) * Math.cos(y / 2.7) +
    8 * Math.sin((x + y) / 1.3) +
    25 * (Math.sin(x / 11) + Math.cos(y / 13))
  return Math.max(0, Math.round(v * 10) / 10)
}

/** 展望台などは目的地付近に丘を盛る */
function hillBonus(category: Category, rng: () => number): number {
  if (category === 'viewpoint') return 30 + rng() * 60
  if (category === 'shrine' || category === 'historic') return rng() * 20
  return 0
}

export function mockElevationProfile(origin: LatLng, dest: LatLng, bonusM = 0, samples = 10): number[] {
  return interpolateLine(origin, dest, samples).map((p, i) => {
    const t = i / (samples - 1)
    return Math.round((mockTerrainElevation(p) + bonusM * t * t) * 10) / 10
  })
}

/** 中心座標・距離帯から決定的に候補を生成 */
export function generateMockPlaces(center: LatLng, minKm: number, maxKm: number, count = MOCK_COUNT): Place[] {
  const seed = hashString(`${center.lat.toFixed(3)},${center.lng.toFixed(3)},${minKm.toFixed(2)},${maxKm.toFixed(2)}`)
  const rng = mulberry32(seed)
  const usedNames = new Set<string>()
  const places: Place[] = []
  const lo = Math.max(0, Math.min(minKm, maxKm))
  const hi = Math.max(minKm, maxKm)
  for (let i = 0; i < count; i++) {
    const category = MOCK_CATEGORIES[i % MOCK_CATEGORIES.length]
    // 方位を均等に分散 + ゆらぎ
    const bearingSeed = (i * 360) / count + (rng() - 0.5) * (360 / count)
    // ドーナツ内で面積一様
    const dist = Math.sqrt(lo * lo + rng() * (hi * hi - lo * lo))
    const pos = destinationPoint(center, bearingSeed, dist)
    let name = ''
    for (let tries = 0; tries < 20; tries++) {
      name = pick(rng, TEMPLATES[category])(pick(rng, PLACE_WORDS), pick(rng, KANA_WORDS))
      if (!usedNames.has(name)) break
    }
    if (usedNames.has(name)) name = `${name} ${i + 1}`
    usedNames.add(name)
    const distanceKm = haversineKm(center, pos)
    const profile = mockElevationProfile(center, pos, hillBonus(category, rng))
    places.push({
      id: `mock:${seed.toString(36)}-${i}`,
      name,
      lat: pos.lat,
      lng: pos.lng,
      category,
      distanceKm,
      bearing: bearingDeg(center, pos),
      tags: { mock: 'yes' },
      source: 'mock',
      elevation: summarizeElevation(profile, distanceKm),
    })
  }
  return places
}

export function createMockProvider(count = MOCK_COUNT): PlaceProvider {
  return {
    name: 'mock',
    async search(center, minKm, maxKm, signal) {
      if (signal?.aborted) {
        const e = new Error('The operation was aborted')
        e.name = 'AbortError'
        throw e
      }
      return generateMockPlaces(center, minKm, maxKm, count)
    },
  }
}
