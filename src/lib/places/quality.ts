/**
 * 行き先の品質ルール（v1.3.2）。実行時の Overpass（isWorthVisiting）と事前生成（scripts/build-poi）の両方で使う。
 * - チェーン店: brand タグが無くても名前で除外（全角半角・英字表記ゆれ対応）
 * - 寺社の付属建物・小祠: 名前で除外（wikidata / heritage があれば残す）
 */

/** 照合用: NFKC・アクセント除去・小文字・空白と記号を除く */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // ラテン文字のアクセント（Café → cafe）。濁点（U+3099）は残す
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s・･·.,'’"“”\-‐－―_~〜!！&＆()（）[\]【】「」『』]/g, '')
}

/**
 * チェーン店の名前（正規化後に「含む」で判定）。日本語表記と英字表記の両方。
 * 短すぎて誤爆しやすい名前（PAUL など）は CHAIN_EXACT_RES で個別に判定する。
 */
export const CHAIN_NAME_PARTS: readonly string[] = [
  // カフェ
  'スターバックス', 'starbucks', 'スタバ',
  'タリーズ', 'tullys',
  'ドトール', 'doutor',
  'エクセルシオール', 'excelsior',
  'コメダ', 'komeda',
  'サンマルク', 'stmarc', 'saintmarc',
  'ベローチェ', 'veloce',
  'プロント', 'pronto',
  '上島珈琲', 'ueshimacoffee',
  '星乃珈琲', 'hoshinocoffee',
  'ルノアール', 'renoir',
  'カフェドクリエ', 'cafedecrie',
  'シャノアール', 'chatnoir',
  '珈琲館', 'kohikan',
  'セガフレード', 'segafredo',
  'ブルーボトル', 'bluebottle',
  'ゴンチャ', 'gongcha',
  // ドーナツ・アイス・洋菓子
  'ミスタードーナツ', 'misterdonut', 'ミスド',
  'クリスピークリーム', 'krispykreme',
  'サーティワン', 'baskinrobbins', '31アイスクリーム',
  'コールドストーン', 'coldstone',
  'ハーゲンダッツ', 'haagendazs',
  '不二家', 'fujiya',
  'コージーコーナー', 'cozycorner',
  'シャトレーゼ', 'chateraise',
  'ゴディバ', 'godiva',
  'ビアードパパ', 'beardpapa',
  // パン
  'リトルマーメイド', 'littlemermaid',
  'ポンパドウル', 'pompadour',
  'アンデルセン', 'andersen',
  '神戸屋', 'kobeya',
  'ヴィドフランス', 'viedefrance',
  'サンジェルマン', 'saintgermain',
  'メゾンカイザー', 'maisonkayser',
  'ドンク', 'donq',
  // v1.4（BACKLOG-3 Q13）
  'mccafe', 'マックカフェ',
  'ブルーシール', 'blueseal',
  'キャラバンコーヒー', 'caravancoffee',
  'ドンレミー', 'donremy',
  'harbs', 'ハーブス',
  '銀座和蘭豆', 'ぎんざおらんだ', '和蘭豆',
  '猿田彦珈琲', 'sarutahiko',
  'アンテンドゥ', 'antendo',
  'ルピシア', 'lupicia',
  'カフェカンパニー',
  'ベックスコーヒー', 'beckscoffee',
  'ホリーズカフェ', 'hollyscafe',
  'ロッテリア',
  'モスカフェ',
  'ヴィ・ド・フランス',
]
const CHAIN_PARTS_NORM = CHAIN_NAME_PARTS.map(normalizeForMatch)

/** 単語として現れたときだけチェーンとみなすもの（PAUL / ポール） */
const CHAIN_EXACT_RES: readonly RegExp[] = [/(^|[\s(（/])paul($|[\s)）/])/i, /^ポール($|[\s・(（])/]

export function isChainName(name: string): boolean {
  const n = normalizeForMatch(name)
  if (CHAIN_PARTS_NORM.some((c) => c && n.includes(c))) return true
  const raw = name.normalize('NFKC')
  return CHAIN_EXACT_RES.some((re) => re.test(raw))
}

/**
 * 寺社の付属建物・境内の小祠・石仏など（名前の末尾 or 一致）。単独の行き先としては弱いので除外する。
 * 「〜堂」は寺社カテゴリのときだけ使う（菓子店の「〇〇堂」を巻き込まない）。
 */
export const WORSHIP_PART_RE =
  /(本殿|拝殿|幣殿|社殿|社務所|授与所|手水舎|手水所|鐘楼|鐘楼堂|鐘撞堂|山門|仁王門|楼門|中門|総門|本堂|堂|祠|小祠|大黒天|地蔵|地蔵尊|神楽殿|神輿庫|神輿殿|宝物殿|鳥居|境内社|末社|摂社|庫裏|客殿|納骨堂)$/

export function isWorshipPartName(name: string): boolean {
  return WORSHIP_PART_RE.test(name.normalize('NFKC').replace(/\s+/g, ''))
}

// ---------------------------------------------------------------------------
// v1.4（BACKLOG-3）
// ---------------------------------------------------------------------------

/**
 * 汎用名（Q1）: これだけでは「どこの」が分からない名前。事前生成では Wikidata の日本語ラベルか、
 * 市区町村名「八幡神社（江東区）」で補う。
 */
export const GENERIC_NAMES: readonly string[] = [
  '八幡神社', '八幡宮', '稲荷神社', '稲荷社', '稲荷', '天祖神社', '氷川神社', '熊野神社', '諏訪神社', '神明社', '神明神社',
  '天神社', '白山神社', '香取神社', '八坂神社', '春日神社', '秋葉神社', '御嶽神社', '浅間神社', '水神社', '八雲神社',
  '白髭神社', '日枝神社', '神社', '寺', '弁天', '弁財天', '観音堂', '地蔵堂', '薬師堂', '不動堂', '庚申塔',
  '五重塔', '三重塔', '展望台', '展望広場', '見晴台', '見晴らし台', '富士見台', '城山', '心字池', '池', '広場', '噴水',
  'viewpoint', 'shrine', 'temple', 'park',
]
const GENERIC_SET = new Set(GENERIC_NAMES.map((n) => normalizeForMatch(n)))
export function isGenericName(name: string): boolean {
  return GENERIC_SET.has(normalizeForMatch(name))
}

/** 動物園の動物（Q2 の確認用。データ側は attraction=animal の除外と、動物園の範囲内への吸収で落とす） */
const ANIMAL_RE =
  /^(アジア)?(ゾウ|キリン|ライオン|トラ|スマトラトラ|アムールトラ|ゴリラ|ニシゴリラ|(ジャイアント|レッサー)?パンダ|ペンギン|(コビト)?カバ|(シロ|クロ)?サイ|シマウマ|フラミンゴ|ホッキョクグマ|カピバラ|チンパンジー|オランウータン|ワニ|アシカ|アザラシ|コアラ|ヤギ|ウサギ|ハシビロコウ|タンチョウ|(ツキノワ|ヒ|マレー)?グマ|ニホンザル|オオカミ|キツネ|タヌキ|カンガルー|ラクダ|ミーアキャット|ビーバー|(コツメ)?カワウソ|ペリカン|フクロウ|ワシ|タカ|オカピ|(マレー)?バク|(ユキ)?ヒョウ|チーター|ハイエナ|ジャガー|ラマ|アルパカ|ポニー|エミュー|ダチョウ|カメ|ゾウガメ|ヒツジ)(舎|園|館|の森|の家|広場)?$/
export function isAnimalName(name: string): boolean {
  return ANIMAL_RE.test(name.normalize('NFKC').replace(/\s+/g, ''))
}

/** 目的地にならないもの（Q3）。アプリ実行時の isWorthVisiting と事前生成で共通 */
export const NOT_DESTINATION_RE =
  /(スタンプ|調整池|沈砂|御用地|御所$|運動場|グラウンド|グランド$|ゴルフ|カート|ビーチコート|駐車場|駐輪場|区画|テニスコート|野球場|バッティング|資材置|ポンプ所|浄水場|変電所|処理場)/i

/** 立入不可・一般公開されていない場所（Q3） */
export const EXCLUDED_QIDS: ReadonlySet<string> = new Set([
  'Q49173570', // 第六台場（上陸禁止）
  'Q11635414', // 赤坂御用地
])

export function isNotDestination(name: string, wikidata?: string): boolean {
  const q = wikidata?.split(';')[0].trim().toUpperCase()
  if (q && EXCLUDED_QIDS.has(q)) return true
  return NOT_DESTINATION_RE.test(name.normalize('NFKC'))
}

/** 小さな史跡（Q11）: 碑・塔・像・墓・台座跡で終わる名前（wikidata も heritage も無い node のとき除外） */
export const SMALL_MONUMENT_RE = /(碑|塔|像|墓|台座跡)$/
export function isSmallMonumentName(name: string): boolean {
  return SMALL_MONUMENT_RE.test(name.normalize('NFKC').replace(/\s+/g, ''))
}

/** 商店街（Q14）: 見どころ（attraction）として扱う */
export const SHOPPING_STREET_RE = /(商店街|道具街|横丁|仲見世|銀座通り|アーケード)$/
export function isShoppingStreetName(name: string): boolean {
  return SHOPPING_STREET_RE.test(name.normalize('NFKC').replace(/\s+/g, ''))
}

/** 日本語（かな・漢字）を含むか（Q9） */
export function hasJapanese(name: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(name)
}
