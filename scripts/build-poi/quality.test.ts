// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { PoiDraft } from './merge'
import { appealScore } from './merge'
import { applyQualityRules, AUTO_CHAIN_MIN_COUNT, isMinorWorship, MINOR_WORSHIP_PENALTY, qualityPenalty, shopBaseName } from './quality'

const d = (id: string, name: string, category: PoiDraft['category'], extra: Partial<PoiDraft> = {}): PoiDraft => ({
  id,
  name,
  lat: 35.7,
  lng: 139.7,
  category,
  tags: {},
  ...extra,
})

describe('applyQualityRules (generator only, v1.3.2)', () => {
  it('absorbs worship nodes inside a precinct (way/relation extent); nodes with wikidata stay', () => {
    const precinct = d('osm:way/1', '浅草寺', 'shrine', { lat: 35.7148, lng: 139.7967, extent: { minlat: 35.713, minlon: 139.795, maxlat: 35.716, maxlon: 139.798 } })
    const { pois, stats } = applyQualityRules([
      precinct,
      d('osm:node/2', '淡島堂横の祠', 'shrine', { lat: 35.7145, lng: 139.7955 }),
      d('osm:node/3', '銭塚地蔵', 'shrine', { lat: 35.7150, lng: 139.7960, tags: { heritage: '2' } }),
      d('osm:node/4', '浅草神社', 'shrine', { lat: 35.7155, lng: 139.7975, tags: { wikidata: 'Q9' } }),
      d('osm:node/5', '待乳山聖天', 'shrine', { lat: 35.718, lng: 139.802 }), // 境内の外
    ])
    expect(pois.map((p) => p.id)).toEqual(['osm:way/1', 'osm:node/4', 'osm:node/5'])
    expect(stats.absorbed).toBe(1) // node/2 は名前（〜祠）、node/3 は吸収（heritage を親へ）
    expect(stats.worshipPart).toBe(1)
    expect(precinct.tags.heritage).toBe('2')
  })

  it('without an extent (Overpass fallback), only nodes within 40m of the precinct center are absorbed', () => {
    const { pois } = applyQualityRules([
      d('osm:way/1', '氷川神社', 'shrine'),
      d('osm:node/2', '氷川神社 拝殿前', 'shrine', { lat: 35.7002 }), // 22m
      d('osm:node/3', '八幡神社', 'shrine', { lat: 35.701 }), // 110m
    ])
    expect(pois.map((p) => p.id)).toEqual(['osm:way/1', 'osm:node/3'])
  })

  it(`treats the same shop name ${AUTO_CHAIN_MIN_COUNT}+ times in Tokyo as a chain (cafes/bakeries/sweets only)`, () => {
    const many = (name: string, n: number, cat: PoiDraft['category']) =>
      Array.from({ length: n }, (_, i) => d(`osm:node/${name}${i}`, `${name} ${['新宿店', '渋谷店', '池袋店', '上野店', '品川店', '目黒店'][i]}`, cat))
    const { pois, stats } = applyQualityRules([
      ...many('やなか珈琲店', 5, 'cafe'),
      ...many('喫茶ひだまり', 4, 'cafe'),
      ...many('八幡神社', 6, 'shrine'), // 寺社は対象外
    ])
    expect(stats.autoChainNames).toEqual(['やなか珈琲店'])
    expect(stats.chainAuto).toBe(5)
    expect(pois.filter((p) => p.name.startsWith('喫茶ひだまり'))).toHaveLength(4)
    expect(pois.filter((p) => p.name.startsWith('八幡神社'))).toHaveLength(6)
  })

  it('name rules also apply to Wikidata-only items (chains); worship parts with wikidata stay', () => {
    const { pois } = applyQualityRules([d('wd:Q1', 'タリーズコーヒー', 'cafe', { tags: { wikidata: 'Q1' } }), d('wd:Q2', '不忍池弁天堂', 'shrine', { tags: { wikidata: 'Q2' } })])
    expect(pois.map((p) => p.id)).toEqual(['wd:Q2'])
  })

  it('shopBaseName drops branch suffixes and normalizes width/case', () => {
    expect(shopBaseName('やなか珈琲店 新宿店')).toBe(shopBaseName('やなか珈琲店（池袋）'))
    expect(shopBaseName('ＣＯＬＯＲＡＤＯ 上野店')).toBe('colorado')
  })

  it('small standalone worship nodes (no wikidata / heritage) are demoted', () => {
    const small = d('osm:node/1', '稲荷神社', 'shrine')
    const big = d('osm:way/2', '稲荷神社', 'shrine')
    expect(isMinorWorship(small)).toBe(true)
    expect(isMinorWorship(big)).toBe(false)
    expect(isMinorWorship(d('osm:node/3', 'x', 'shrine', { tags: { wikidata: 'Q1' } }))).toBe(false)
    expect(appealScore(small) - qualityPenalty(small)).toBe(-MINOR_WORSHIP_PENALTY)
    expect(qualityPenalty(big)).toBe(0)
  })
})
