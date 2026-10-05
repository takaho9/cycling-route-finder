import type { CSSProperties } from 'react'
import { CATEGORY_META } from '../lib/categories'
import { formatMinutesJa } from '../lib/reach'
import { ElevationBadge, MiniElevation } from './Elevation'
import { HeartIcon } from './Icons'
import { PlacePhoto } from './PlacePhoto'
import type { ViewPlace } from './types'

export interface CardMetrics {
  /** 片道の走行距離の目安 (km) */
  km: number
  /** 往復の走行時間の目安 (分) */
  min: number
}

/** 候補カード（DESIGN §3.2） */
export function PlaceCard({
  place,
  metrics,
  index = 0,
  onOpen,
  onToggleFavorite,
  observe,
  interactive = true,
}: {
  place: ViewPlace
  metrics: CardMetrics
  index?: number
  onOpen?: (p: ViewPlace) => void
  onToggleFavorite?: (p: ViewPlace) => void
  observe?: (el: HTMLElement | null) => void
  interactive?: boolean
}) {
  const cat = CATEGORY_META[place.category]
  return (
    <article
      className="card"
      data-place-id={place.id}
      ref={observe}
      style={{ '--i': Math.min(index, 8) } as CSSProperties}
    >
      <div className="card__photo">
        <PlacePhoto id={place.id} name={place.name} category={place.category} photo={place.photo} />
        <div className="card__overlay" />
        <span className="cat-pill">
          <span aria-hidden="true">{cat.emoji}</span> {cat.label}
        </span>
        {onToggleFavorite && (
          <button
            type="button"
            className={`card__fav icon-btn pressable${place.favorite ? ' is-on' : ''}`}
            aria-pressed={place.favorite}
            aria-label={place.favorite ? `${place.name}をお気に入りから外す` : `${place.name}をお気に入りに追加`}
            onClick={() => onToggleFavorite(place)}
          >
            <HeartIcon filled={place.favorite} />
          </button>
        )}
        <div className="card__text">
          <h3 className="card__title">
            {interactive && onOpen ? (
              <button type="button" className="card__open" onClick={() => onOpen(place)}>
                {place.name}
              </button>
            ) : (
              place.name
            )}
          </h3>
          <p className="card__meta">
            <span className="num">{metrics.km.toFixed(1)}km</span> · 往復<span className="num">{formatMinutesJa(metrics.min)}</span>
            {place.visited && <span className="visited-pill">✓ 行った</span>}
          </p>
        </div>
      </div>
      <div className="card__band">
        <ElevationBadge summary={place.elevation} state={place.elevationState} />
        {place.elevationState === 'loading' ? (
          <span className="skeleton skeleton--graph" aria-hidden="true" />
        ) : (
          place.elevation && <MiniElevation summary={place.elevation} />
        )}
      </div>
    </article>
  )
}
