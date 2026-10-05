import type { ObserveRef } from '../hooks/useEnrichment'
import { CATEGORY_META } from '../lib/categories'
import type { TripEstimate } from '../lib/trip'
import { ElevationBadge, MiniElevation } from './Elevation'
import { TripLine } from './PlaceCard'
import { PlacePhoto } from './PlacePhoto'
import type { ViewPlace } from './types'

/**
 * 今日のおすすめ（大カード, BACKLOG 提案型 / BACKLOG-2 D9）。
 * - 「⏱ 40分 · 片道5.4km」を大きな数字で。右にミニ標高グラフ
 * - 詳細は写真かタイトルのタップで開く
 * - カードから直接「出発」= 2 タップ。ただし実 API 失敗でデモに落ちているときは出発ボタンを出さない（C6）
 */
export function RecommendCard({
  place,
  trip,
  rank,
  goHref,
  goLabel,
  canDepart,
  onGo,
  onOpen,
  observe,
}: {
  place: ViewPlace
  trip: TripEstimate
  rank: number
  goHref: string
  goLabel: string
  /** false = カードから直接出発させない（デモに落ちたとき, C6） */
  canDepart: boolean
  onGo: (p: ViewPlace) => void
  onOpen: (p: ViewPlace) => void
  observe?: ObserveRef
}) {
  const cat = CATEGORY_META[place.category]
  return (
    <article className="rec-card" data-place-id={place.id} ref={observe}>
      <button type="button" className="rec-card__photo" onClick={() => onOpen(place)} aria-label={`${place.name}の詳細`} tabIndex={-1}>
        <PlacePhoto id={place.id} name={place.name} category={place.category} photo={place.photo} />
        <span className="rec-card__shade" />
        <span className="rec-card__rank num" aria-hidden="true">
          {rank}
        </span>
        <span className="cat-pill">
          <span aria-hidden="true">{cat.emoji}</span> {cat.label}
        </span>
      </button>
      <div className="rec-card__body">
        <h3 className="rec-card__title">
          <button type="button" className="rec-card__open" onClick={() => onOpen(place)}>
            {place.name}
          </button>
        </h3>
        <div className="rec-card__stats">
          <TripLine trip={trip} className="trip--hero" />
          {place.elevationState === 'loading' ? (
            <span className="skeleton skeleton--graph" aria-hidden="true" />
          ) : (
            place.elevation && <MiniElevation summary={place.elevation} width={88} height={32} />
          )}
        </div>
        <div className="rec-card__row">
          <ElevationBadge summary={place.elevation} state={place.elevationState} />
          {place.visited && <span className="visited-pill">✓ 行った</span>}
        </div>
        {canDepart ? (
          <a className="btn btn--primary rec-card__go pressable" href={goHref} target="_blank" rel="noopener" onClick={() => onGo(place)}>
            🚲 {goLabel} <span className="arrow">→</span>
          </a>
        ) : (
          <button type="button" className="btn btn--secondary rec-card__go pressable" onClick={() => onOpen(place)}>
            くわしく見る <span className="arrow">→</span>
          </button>
        )}
      </div>
    </article>
  )
}
