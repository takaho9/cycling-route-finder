import type { CSSProperties } from 'react'
import type { ObserveRef } from '../hooks/useEnrichment'
import { CATEGORY_META } from '../lib/categories'
import type { TripEstimate } from '../lib/trip'
import { CountUp, RouteUpdatedPill, useFlash } from './CountUp'
import { ElevationBadge, MiniElevation } from './Elevation'
import { HeartIcon } from './Icons'
import { PlacePhoto } from './PlacePhoto'
import type { ViewPlace } from './types'

/**
 * 「⏱ 40分 · 片道5.4km」（BACKLOG-2 D2/D9）。時間は現在のルート（既定 往復）の走行目安、距離は片道と明記。
 * 経路距離が届いたらカウントアップし、「経路で更新」ピルを 2 秒出す。
 */
export function TripLine({ trip, className = '' }: { trip: TripEstimate; className?: string }) {
  const flash = useFlash(trip.routed ? trip.oneWayKm : undefined)
  const modeLabel = trip.mode === 'round' ? '往復' : '片道'
  return (
    <p className={`trip ${className}`} aria-label={`${modeLabel}の走行目安 ${trip.minutes}分、片道 ${trip.oneWayKm.toFixed(1)}km`}>
      <span className="trip__time" aria-hidden="true">
        <span className="trip__icon">⏱</span>
        <span className="num trip__big">
          <CountUp value={trip.minutes} />
        </span>
        分
      </span>
      <span className="trip__sep" aria-hidden="true">
        ·
      </span>
      <span className="trip__km" aria-hidden="true">
        片道<span className="num trip__big">
          <CountUp value={trip.oneWayKm} decimals={1} />
        </span>
        km
      </span>
      {flash && <RouteUpdatedPill />}
    </p>
  )
}

/** 候補カード（DESIGN §3.2） */
export function PlaceCard({
  place,
  trip,
  index = 0,
  onOpen,
  onToggleFavorite,
  observe,
  interactive = true,
  showNew = false,
}: {
  place: ViewPlace
  trip: TripEstimate
  index?: number
  onOpen?: (p: ViewPlace) => void
  onToggleFavorite?: (p: ViewPlace) => void
  observe?: ObserveRef
  interactive?: boolean
  /** 未訪問なら NEW リボン（ガチャ結果, D3） */
  showNew?: boolean
}) {
  const cat = CATEGORY_META[place.category]
  return (
    <article className="card" data-place-id={place.id} ref={observe} style={{ '--i': Math.min(index, 8) } as CSSProperties}>
      <div className="card__photo">
        <PlacePhoto id={place.id} name={place.name} category={place.category} photo={place.photo} />
        <div className="card__overlay" />
        <span className="cat-pill">
          <span aria-hidden="true">{cat.emoji}</span> {cat.label}
        </span>
        {showNew && !place.visited && (
          <span className="new-ribbon" aria-label="まだ行ったことない場所">
            NEW
          </span>
        )}
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
          <div className="card__meta">
            <TripLine trip={trip} className="trip--on-photo" />
            {place.visited && <span className="visited-pill">✓ 行った</span>}
          </div>
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
