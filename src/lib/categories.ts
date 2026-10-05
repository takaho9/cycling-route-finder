import { hashString } from './random'
import type { Category } from './types'

export interface CategoryMeta {
  label: string
  emoji: string
  /** フォールバック画像のグラデーション (from → to) */
  from: string
  to: string
}

/**
 * カテゴリ定義の唯一のテーブル（DESIGN.md §5 と同期。コード側が正, BACKLOG Y10）。
 * フィルタチップ・カテゴリピル・スタンプ・写真フォールバックで共通利用。
 */
export const CATEGORY_META: Record<Category, CategoryMeta> = {
  park: { label: '公園・緑地', emoji: '🌳', from: '#3BB273', to: '#A8E063' },
  viewpoint: { label: '展望スポット', emoji: '🔭', from: '#5B6CFF', to: '#9DB4FF' },
  cafe: { label: 'カフェ', emoji: '☕', from: '#B9784A', to: '#F2C29B' },
  bakery: { label: 'パン屋', emoji: '🥐', from: '#F2A65A', to: '#FFE1A8' },
  shrine: { label: '神社・お寺', emoji: '⛩️', from: '#D7263D', to: '#FF8E72' },
  waterside: { label: '川辺・水辺', emoji: '🌊', from: '#0E8C8C', to: '#6FE3E1' },
  seaside: { label: '海・ベイエリア', emoji: '🏖️', from: '#1B9AF5', to: '#8EE3F5' },
  historic: { label: '史跡・名所', emoji: '🏯', from: '#7A5C3E', to: '#D4B483' },
  museum: { label: 'ミュージアム', emoji: '🖼️', from: '#6C4AB6', to: '#C3A6FF' },
  sweets: { label: '甘いもの', emoji: '🍦', from: '#FF6FA5', to: '#FFC2D8' },
  attraction: { label: '見どころ', emoji: '✨', from: '#00796B', to: '#FFD54F' },
  roadside_station: { label: '道の駅', emoji: '🚏', from: '#5A7D2A', to: '#E8D36A' },
  other: { label: 'ぶらり', emoji: '🚲', from: '#FF5A1F', to: '#FFB800' },
}

/** フィルタチップの表示順 */
export const CATEGORY_ORDER: Category[] = [
  'cafe',
  'shrine',
  'park',
  'waterside',
  'seaside',
  'historic',
  'bakery',
  'sweets',
  'viewpoint',
  'museum',
  'attraction',
  'roadside_station',
  'other',
]

/** 同カテゴリ内で単調にならないよう、場所 ID のハッシュで 115〜155deg に揺らす */
export function fallbackAngle(id: string): number {
  return 115 + (hashString(id) % 41)
}

export function fallbackGradient(category: Category, id: string): string {
  const m = CATEGORY_META[category]
  return `linear-gradient(${fallbackAngle(id)}deg, ${m.from}, ${m.to})`
}
