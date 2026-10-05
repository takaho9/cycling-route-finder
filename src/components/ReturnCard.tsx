import { useId } from 'react'
import { CATEGORY_META } from '../lib/categories'
import type { Departure } from '../lib/storage'

/** 帰還時の「行ってきた？」帯（BACKLOG R7 / BACKLOG-2 D10: 高さ 64px の 1 行） */
export function ReturnCard({ departure, onYes, onNo }: { departure: Departure; onYes: () => void; onNo: () => void }) {
  const titleId = useId()
  const emoji = departure.category ? CATEGORY_META[departure.category].emoji : '📍'
  return (
    <section className="return-card" aria-labelledby={titleId}>
      <span className="return-card__emoji" aria-hidden="true">
        {emoji}
      </span>
      <h2 id={titleId} className="return-card__title">
        <span className="return-card__name">{departure.name}</span>
        <span className="visually-hidden">、</span>
        <span className="return-card__ask">行ってきた？</span>
      </h2>
      <button type="button" className="btn btn--primary return-card__yes pressable" onClick={onYes}>
        ✓ 走った
      </button>
      <button type="button" className="icon-btn return-card__no pressable" onClick={onNo} aria-label="行かなかった">
        <span aria-hidden="true">✕</span>
      </button>
    </section>
  )
}
