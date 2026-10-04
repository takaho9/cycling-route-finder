import { CATEGORY_META } from '../lib/categories'
import type { Departure } from '../lib/storage'

/** 帰還時の「行ってきた？」カード（BACKLOG R7） */
export function ReturnCard({ departure, onYes, onNo }: { departure: Departure; onYes: () => void; onNo: () => void }) {
  const emoji = departure.category ? CATEGORY_META[departure.category].emoji : '📍'
  return (
    <section className="return-card" aria-labelledby="return-title">
      <span className="return-card__emoji" aria-hidden="true">
        {emoji}
      </span>
      <div className="return-card__text">
        <h2 id="return-title" className="return-card__title">
          {departure.name}、行ってきた？
        </h2>
        <p className="return-card__sub">記録するとスタンプがもらえるよ</p>
      </div>
      <div className="return-card__actions">
        <button type="button" className="btn btn--primary return-card__yes pressable" onClick={onYes}>
          ✓ 走った
        </button>
        <button type="button" className="btn btn--text pressable" onClick={onNo}>
          ✕ 行かなかった
        </button>
      </div>
    </section>
  )
}
