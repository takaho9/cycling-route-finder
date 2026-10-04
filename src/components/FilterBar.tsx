import { CATEGORY_META, CATEGORY_ORDER } from '../lib/categories'
import { SORT_LABELS, type ElevationFilter, type SortKey } from '../lib/candidates'
import type { Category } from '../lib/types'
import { ElevationIcon } from './Icons'

const ELEV_CHIPS: { id: ElevationFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'flat', label: '平坦' },
  { id: 'rolling', label: 'ゆる' },
  { id: 'hilly', label: 'ヒル' },
]

/** 一覧のフィルタ／並び替え（DESIGN §3.2, sticky） */
export function FilterBar({
  elevation,
  onElevation,
  categories,
  available,
  onToggleCategory,
  sort,
  onSort,
}: {
  elevation: ElevationFilter
  onElevation: (f: ElevationFilter) => void
  categories: ReadonlySet<Category>
  available: readonly Category[]
  onToggleCategory: (c: Category) => void
  sort: SortKey
  onSort: (s: SortKey) => void
}) {
  const cats = CATEGORY_ORDER.filter((c) => available.includes(c))
  return (
    <div className="filters">
      <div className="filters__row chips" role="radiogroup" aria-label="高低差">
        {ELEV_CHIPS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={elevation === c.id}
            className={`chip chip--${c.id} pressable${elevation === c.id ? ' is-on' : ''}`}
            onClick={() => onElevation(c.id)}
          >
            {c.id !== 'all' && <ElevationIcon label={c.id} size={14} />}
            {c.label}
          </button>
        ))}
      </div>
      <div className="filters__row">
        <div className="chips chips--cats" role="group" aria-label="カテゴリ">
          {cats.map((c) => (
            <button
              key={c}
              type="button"
              className={`cat-chip pressable${categories.has(c) ? ' is-on' : ''}`}
              aria-pressed={categories.has(c)}
              aria-label={CATEGORY_META[c].label}
              title={CATEGORY_META[c].label}
              onClick={() => onToggleCategory(c)}
            >
              {CATEGORY_META[c].emoji}
            </button>
          ))}
        </div>
        <label className="sort">
          <span className="visually-hidden">並び替え</span>
          <select value={sort} onChange={(e) => onSort(e.target.value as SortKey)}>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
