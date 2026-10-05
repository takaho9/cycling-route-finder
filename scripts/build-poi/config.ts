/**
 * 都内データ事前生成（v1.3）の設定。GitHub Actions（.github/workflows/build-data.yml）で実行する。
 * ここに書いた外部サービスには、この開発コンテナからは接続できない（ローカルは fixture でテスト）。
 */
import type { Category } from '../../src/lib/types'

export const REGION_NAME = '東京都（島しょ部を除く）'
/** Overpass の area 指定（東京都） */
export const OVERPASS_AREA_FILTER = '["ISO3166-2"="JP-13"]'
/** Wikidata: 東京都 */
export const WIKIDATA_TOKYO = 'Q1490'
/** これより南は伊豆諸島・小笠原（除外） */
export const MAINLAND_MIN_LAT = 35.4
/** 東京都本土のおおよその範囲（Wikidata 座標フィルタ・健全性チェック用） [s, w, n, e] */
export const MAINLAND_BBOX: [number, number, number, number] = [35.45, 138.85, 35.95, 139.95]
/** 統合の基準点（距離計算に使うだけ。東京駅） */
export const TOKYO_STATION = { lat: 35.6812, lng: 139.7671 }

/** CI からの Overpass エンドポイント（v1.3.1 からはフォールバック専用。失敗したら次へ） */
export const BUILD_OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const
/** OSM の主経路（v1.3.1）: Geofabrik の関東抽出 PBF ＋ osmium-tool */
export const GEOFABRIK_KANTO_URL = 'https://download.geofabrik.de/asia/japan/kanto-latest.osm.pbf'
/** Overpass フォールバックのグリッド (度) とクエリ間隔 (ms) */
export const OVERPASS_GRID_DEG = 0.1
export const OVERPASS_GRID_GAP_MS = 5_000
export const OVERPASS_GRID_TIMEOUT_S = 90
export const WIKIDATA_SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql'

/**
 * User-Agent（Overpass / Wikimedia の利用規約で連絡先の明記が求められる）。
 * 連絡先は POI_CONTACT（Actions では repo の Issues URL）で上書きできる。
 */
export function userAgent(contact = process.env.POI_CONTACT || 'https://github.com/takaho9/cycling-route-finder/issues'): string {
  return `choichari-build-poi/1.3 (static POI data for a non-commercial PWA; ${contact})`
}

/** 統合: 名前が似ていて、この距離以内なら同じもの (m) */
export const MATCH_RADIUS_M = 150
/** Wikidata だけにある項目を採用する最小 sitelinks（記事が 1 つ以上ある＝それなりに知られている） */
export const WD_ONLY_MIN_SITELINKS = 1
/** 橋は数が多いので、Wikidata だけの橋は sitelinks 4 以上か文化財（v1.4 Q12） */
export const WD_ONLY_MIN_SITELINKS_BRIDGE = 4

/** Commons 近傍検索の上限（任意。CI でも重いので件数を絞る） */
export const DEFAULT_NEARBY_LIMIT = 1000
/** Commons の Category: リンクから代表画像をさがす上限（v1.4 Q15） */
export const DEFAULT_CATEGORY_PHOTO_LIMIT = 800

/** 健全性チェック: 最低件数（本番）。fixture では使わない */
export const DEFAULT_MIN_COUNT = 3000
/** 健全性チェック: 前回比でこれ以上減ったら失敗 */
export const MAX_SHRINK_RATIO = 0.3

/**
 * Wikidata のクラス（P31/P279*）のホワイトリスト → カテゴリ。上から順に優先。
 * 初回実行時はログのクラス別件数を見て、効いていない QID が無いか確認すること。
 */
export const WIKIDATA_CLASSES: readonly { qid: string; label: string; category: Category }[] = [
  { qid: 'Q845945', label: '神社', category: 'shrine' },
  { qid: 'Q5393308', label: '仏教寺院', category: 'shrine' },
  { qid: 'Q1440300', label: '展望塔', category: 'viewpoint' },
  { qid: 'Q8502', label: '山', category: 'viewpoint' },
  { qid: 'Q17715832', label: '城跡', category: 'historic' },
  { qid: 'Q23413', label: '城', category: 'historic' },
  { qid: 'Q839954', label: '遺跡', category: 'historic' },
  { qid: 'Q4989906', label: '記念建造物', category: 'historic' },
  { qid: 'Q16560', label: '宮殿', category: 'historic' },
  { qid: 'Q207694', label: '美術館', category: 'museum' },
  { qid: 'Q33506', label: '博物館', category: 'museum' },
  { qid: 'Q1107656', label: '庭園', category: 'park' },
  { qid: 'Q22698', label: '公園', category: 'park' },
  { qid: 'Q40080', label: '砂浜', category: 'seaside' },
  { qid: 'Q23397', label: '湖', category: 'waterside' },
  { qid: 'Q3253281', label: '池', category: 'waterside' },
  { qid: 'Q12280', label: '橋', category: 'attraction' },
  { qid: 'Q570116', label: '観光地', category: 'attraction' },
  { qid: 'Q2319498', label: '名所', category: 'attraction' },
]

export const DATA_SOURCES = [
  {
    name: '© OpenStreetMap contributors',
    license: 'ODbL 1.0（このデータも ODbL で提供）',
    url: 'https://www.openstreetmap.org/copyright',
  },
  { name: 'Wikidata', license: 'CC0 1.0', url: 'https://www.wikidata.org/' },
  {
    name: 'Wikimedia Commons（写真）',
    license: '作者・ライセンスは各写真に記載',
    url: 'https://commons.wikimedia.org/',
  },
]
