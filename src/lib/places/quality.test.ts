import { describe, expect, it } from 'vitest'
import { categorizeOsmTags, parseOverpassElements } from './overpass'
import { isChainName, isWorshipPartName } from './quality'

describe('chain names without a brand tag (v1.3.2)', () => {
  it.each([
    'タリーズコーヒー 新宿店',
    "TULLY'S COFFEE",
    'ＴＵＬＬＹ’Ｓ　ＣＯＦＦＥＥ',
    'ｽﾀｰﾊﾞｯｸｽ ｺｰﾋｰ',
    'Starbucks Coffee 渋谷店',
    'ドトールコーヒーショップ新宿東口店',
    'エクセルシオール カフェ',
    'コメダ珈琲店',
    'サンマルクカフェ',
    'St.Marc Café',
    'カフェ・ベローチェ',
    'PRONTO',
    '上島珈琲店',
    '星乃珈琲店',
    '喫茶室ルノアール',
    'カフェ・ド・クリエ',
    'Café de CRIÉ',
    '珈琲館 本郷店',
    'ミスタードーナツ',
    'サーティワンアイスクリーム',
    '不二家洋菓子店',
    '銀座コージーコーナー',
    'シャトレーゼ',
    'リトルマーメイド',
    'ポンパドウル',
    'アンデルセン',
    '神戸屋キッチン',
    'ヴィ・ド・フランス',
    'サンジェルマン',
    'PAUL 新宿店',
    'ポール (PAUL)',
  ])('%s is a chain', (name) => expect(isChainName(name)).toBe(true))

  it.each(['カフェーパウリスタ', '喫茶ポールスター', 'さぼうる', 'ラドリオ', '木村家', '梅園', 'Paulista'])('%s is not a chain', (name) =>
    expect(isChainName(name)).toBe(false),
  )
})

describe('worship sub-buildings and small shrines (v1.3.2)', () => {
  it.each(['本殿', '拝殿', '阿伎留神社社務所', '手水舎', '鐘楼', '山門', '福昌寺本堂', '浄福寺観音堂', '〇〇祈願堂', '山王清兵衛祠', '正福寺 大黒天', '金山地蔵尊', '地蔵'])(
    '%s is a sub-building',
    (name) => expect(isWorshipPartName(name)).toBe(true),
  )
  it.each(['浅草寺', '神田明神', '湯島天満宮', '増上寺', '豊川稲荷東京別院'])('%s is a destination', (name) => expect(isWorshipPartName(name)).toBe(false))

  it('isWorthVisiting drops sub-buildings and brand-less chains, but keeps sub-buildings with wikidata/heritage', () => {
    const C = { lat: 35.68, lng: 139.76 }
    const node = (id: number, tags: Record<string, string>) => ({ type: 'node' as const, id, lat: 35.68, lon: 139.76, tags })
    const names = parseOverpassElements(
      [
        node(1, { name: '本殿', amenity: 'place_of_worship', religion: 'shinto' }),
        node(2, { name: '不忍池弁天堂', amenity: 'place_of_worship', religion: 'buddhist', wikidata: 'Q1' }),
        node(3, { name: '正福寺地蔵堂', amenity: 'place_of_worship', religion: 'buddhist', heritage: '1' }),
        node(4, { name: 'タリーズコーヒー', amenity: 'cafe' }),
        node(5, { name: '喫茶ひだまり', amenity: 'cafe' }),
        node(6, { name: '文明堂', shop: 'confectionery' }), // 「〜堂」は寺社だけ
      ],
      C,
    ).map((p) => p.name)
    expect(names).toEqual(['不忍池弁天堂', '正福寺地蔵堂', '喫茶ひだまり', '文明堂'])
  })
})

describe('seaside is limited to real seaside names (v1.3.2)', () => {
  it.each([
    ['浜離宮恩賜庭園', 'garden', 'park'],
    ['浜町公園', 'park', 'park'],
    ['京浜運河緑道公園', 'park', 'park'],
    ['葛西臨海公園', 'park', 'seaside'],
    ['お台場海浜公園', 'park', 'seaside'],
    ['森ヶ崎海岸公園', 'park', 'seaside'],
    ['つばさ浜', 'park', 'seaside'],
  ])('%s (%s) → %s', (name, leisure, cat) => expect(categorizeOsmTags({ name, leisure })).toBe(cat))
})

describe('v1.4 runtime rules (isWorthVisiting / categorize)', () => {
  const C = { lat: 35.68, lng: 139.76 }
  const node = (id: number, tags: Record<string, string>) => ({ type: 'node' as const, id, lat: 35.68, lon: 139.76, tags })
  it('Q3 / Q2 / Q4 / Q14: drops non-destinations, animals, unknown peaks and shops tagged as attractions', () => {
    const names = parseOverpassElements(
      [
        node(1, { name: '東中野駅 駅スタンプ', tourism: 'attraction' }),
        node(2, { name: 'フナボリゴルフ', tourism: 'attraction' }),
        node(3, { name: 'ハシビロコウ', tourism: 'attraction', attraction: 'animal' }),
        node(4, { name: '高尾山', natural: 'peak', wikidata: 'Q1' }),
        node(5, { name: '名もなき峰', natural: 'peak' }),
        node(6, { name: 'お土産店', tourism: 'attraction', shop: 'gift' }),
        node(7, { name: '合羽橋道具街', historic: 'yes' }),
        node(8, { name: '上野動物園', tourism: 'zoo' }),
        node(9, { name: '赤坂の何か', tourism: 'attraction', wikidata: 'Q11635414' }),
      ],
      C,
    ).map((p) => `${p.name}:${p.category}`)
    expect(names).toEqual(['高尾山:viewpoint', '合羽橋道具街:attraction', '上野動物園:attraction'])
  })

  it('Q13: more chains', () => {
    for (const n of ['McCafé by Barista', 'ブルーシール', 'キャラバンコーヒー 船堀店', 'ドンレミー', 'HARBS', '銀座和蘭豆', '猿田彦珈琲']) expect(isChainName(n)).toBe(true)
  })

  it('generic / animal / not-destination detectors used by the simulation', async () => {
    const { isGenericName, isAnimalName, isNotDestination } = await import('./quality')
    expect(isGenericName('八幡神社')).toBe(true)
    expect(isGenericName('八幡神社（江東区）')).toBe(false)
    expect(isAnimalName('ハシビロコウ')).toBe(true)
    expect(isAnimalName('ゾウ舎')).toBe(true)
    expect(isNotDestination('第六台場', 'Q49173570')).toBe(true)
    expect(isNotDestination('つどいの池 (調整池)')).toBe(true)
    expect(isNotDestination('代々木公園')).toBe(false)
  })
})
