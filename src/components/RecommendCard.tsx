import { CATEGORY_META } from '../lib/categories'
import { formatMinutesJa } from '../lib/reach'
import { ElevationBadge } from './Elevation'
import { PlacePhoto } from './PlacePhoto'
import type { CardMetrics } from './PlaceCard'
import type { ViewPlace } from './types'

/**
 * 今日のおすすめ（大カード）。カードから直接「出発」= 2 タップ（BACKLOG 提案型）。
 */
export function RecommendCard({
  place,
  metrics,
  rank,
  goHref,
  goLabel,
  demo,
  onGo,
  onOpen,
  observe,
}: {
  place: ViewPlace
  metrics: CardMetrics
  rank: number
  goHref: string
  goLabel: string
  demo: boolean
  onGo: (p: ViewPlace) => void
  onOpen: (p: ViewPlace) => void
  observe?: (el: HTMLElement | null) => void
}) {
  const cat = CATEGORY_META[place.category]
  return (
    <article className="rec-card" data-place-id={place.id} ref={observe}>
      <button type="button" className="rec-card__photo" onClick={() => onOpen(place)} aria-label={`${place.name}の詳細`}>
        <PlacePhoto id={place.id} name={place.name} category={place.category} photo={place.photo} />
        <span className="card__overlay" />
        <span className="rec-card__rank num" aria-hidden="true">
          {rank}
        </span>
        <span className="cat-pill">
          <span aria-hidden="true">{cat.emoji}</span> {cat.label}
        </span>
      </button>
      <div className="rec-card__body">
        <h3 className="rec-card__title">{place.name}</h3>
        <p className="rec-card__meta">
          <span className="num">{metrics.km.toFixed(1)}km</span> · 往復<span className="num">{formatMinutesJa(metrics.min)}</span>
          {place.visited && <span className="visited-pill">✓ 行った</span>}
        </p>
        <div className="rec-card__row">
          <ElevationBadge summary={place.elevation} state={place.elevationState} />
          <button type="button" className="btn btn--text rec-card__more" onClick={() => onOpen(place)}>
            くわしく
          </button>
        </div>
        <a className="btn btn--primary rec-card__go pressable" href={goHref} target="_blank" rel="noopener" onClick={() => onGo(place)}>
          🚲 {goLabel} <span className="arrow">→</span>
        </a>
        {demo && <p className="demo-note">※ デモの架空の場所だよ。地図は開けるけど実在しないかも</p>}
      </div>
    </article>
  )
}
