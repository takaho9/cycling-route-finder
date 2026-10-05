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
