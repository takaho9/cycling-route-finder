/**
 * クレジット表示（BACKLOG R8）とプライバシー表記（A9）の唯一の定義。設定画面と README で同じ内容を使う。
 */
export interface Credit {
  /** 何に使っているか */
  role: string
  /** 表示するクレジット文字列 */
  text: string
  href: string
}

export const CREDITS: readonly Credit[] = [
  { role: '地図データ・行き先', text: '© OpenStreetMap contributors (ODbL)', href: 'https://www.openstreetmap.org/copyright' },
  { role: '標高', text: 'Elevation data: Open-Meteo (CC BY 4.0)', href: 'https://open-meteo.com/' },
  { role: '経路', text: 'Routing: FOSSGIS e.V. (routing.openstreetmap.de)', href: 'https://routing.openstreetmap.de/about.html' },
  { role: '写真', text: 'Wikimedia Commons（作者・ライセンスは各写真に表示）', href: 'https://commons.wikimedia.org/' },
  { role: '写真さがし', text: 'Wikidata (CC0)', href: 'https://www.wikidata.org/' },
  { role: '地名検索', text: 'Nominatim / © OpenStreetMap contributors', href: 'https://nominatim.org/' },
  { role: 'ナビ', text: 'Google マップ（URL で開くだけ）', href: 'https://www.google.com/maps' },
  { role: '数字フォント', text: 'Outfit (SIL Open Font License)', href: 'https://fonts.google.com/specimen/Outfit' },
]

export interface PrivacyDestination {
  host: string
  what: string
}

/** 外部に送るもの（すべて無料の公開 API。アカウント・解析ツールなし） */
export const PRIVACY_DESTINATIONS: readonly PrivacyDestination[] = [
  { host: 'overpass-api.de ほか Overpass API', what: '約1km単位に丸めた検索の中心' },
  { host: 'api.open-meteo.com', what: '候補までの道のりの座標（約11m単位）' },
  { host: 'routing.openstreetmap.de', what: '出発地と目的地（約11m単位、詳細を開いたときだけ）' },
  { host: 'nominatim.openstreetmap.org', what: '入力した地名／現在地の地名（約100m単位）' },
  { host: 'wikidata.org / commons.wikimedia.org', what: '行き先の ID と座標（写真さがし）' },
  { host: 'Google マップ', what: '出発ボタンを押したときの目的地（往復なら出発地も）' },
]

export const PRIVACY_SUMMARY =
  '位置情報はこの端末の中で使い、候補さがしに必要なぶんだけ丸めた座標を下の公開 API に送るよ。アカウント・サーバー・広告・解析ツールはなし。記録やお気に入りはこの端末にだけ保存される。'

export const NON_COMMERCIAL_NOTE = '個人の非商用アプリ（広告・課金なし）。各 API の無料枠と利用規約の範囲で使っているよ。'
