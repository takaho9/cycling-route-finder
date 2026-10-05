import { CATEGORY_META, fallbackGradient } from '../lib/categories'
import type { Category } from '../lib/types'

/** 写真が無いときのカテゴリ別ビジュアル（DESIGN §5）。「写真なし」とは書かない */
export function PhotoFallback({ category, id }: { category: Category; id: string }) {
  const m = CATEGORY_META[category]
  return (
    <div className="photo-fallback" style={{ background: fallbackGradient(category, id) }} role="img" aria-label={`${m.label}のイメージ`}>
      <span className="photo-fallback__ghost" aria-hidden="true">
        {m.emoji}
      </span>
      <span className="photo-fallback__emoji" aria-hidden="true">
        {m.emoji}
      </span>
      <svg className="photo-fallback__road" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 40 C 80 10, 160 60, 240 30 S 360 20, 400 36 L400 60 L0 60 Z" />
      </svg>
    </div>
  )
}
