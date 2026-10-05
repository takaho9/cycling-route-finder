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

/**
 * 一覧のフィルタ（DESIGN §3.2, sticky / BACKLOG-2 D13）。
 * 高低差とカテゴリを 1 段の横スクロールにまとめる。カテゴリは選択中だけラベルを出す。並び順は件数行へ。
 */
export function FilterBar({
  elevation,
  onElevation,
  categories,
  available,
  onToggleCategory,
}: {
  elevation: ElevationFilter
  onElevation: (f: ElevationFilter) => void
  categories: ReadonlySet<Category>
  available: readonly Category[]
  onToggleCategory: (c: Category) => void
}) {
  const cats = CATEGORY_ORDER.filter((c) => available.includes(c))
  return (
    <div className="filters">
      <div className="filters__row chips">
        <div className="chips__group" role="radiogroup" aria-label="高低差">
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
        <span className="chips__divider" aria-hidden="true" />
        <div className="chips__group" role="group" aria-label="カテゴリ">
          {cats.map((c) => {
            const on = categories.has(c)
            return (
              <button
                key={c}
                type="button"
                className={`cat-chip pressable${on ? ' is-on' : ''}`}
                aria-pressed={on}
                aria-label={CATEGORY_META[c].label}
                title={CATEGORY_META[c].label}
                onClick={() => onToggleCategory(c)}
              >
                <span aria-hidden="true">{CATEGORY_META[c].emoji}</span>
                {on && (
                  <span className="cat-chip__label" aria-hidden="true">
                    {CATEGORY_META[c].label}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** 並び替え（件数と同じ 1 行に置く, D13） */
export function SortSelect({ sort, onSort }: { sort: SortKey; onSort: (s: SortKey) => void }) {
  return (
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
  )
}
