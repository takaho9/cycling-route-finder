import { useEffect, useState } from 'react'
import { CATEGORY_META } from '../lib/categories'
import { buildDepartUrl } from '../lib/gmaps'
import { PHOTO_WIDTH_DETAIL, type PhotoInfo } from '../lib/photos'
import { formatMinutesJa, isRouteOverBudget } from '../lib/reach'
import type { RouteResult } from '../lib/routing'
import type { Services } from '../lib/services'
import { tripEstimate, type TripEstimate } from '../lib/trip'
import type { ElevationSummary } from '../lib/types'
import { BottomSheet } from './BottomSheet'
import { CountUp, RouteUpdatedPill, useFlash } from './CountUp'
import { ELEVATION_TEXT, ElevationProfile } from './Elevation'
import { ElevationIcon, HeartIcon } from './Icons'
import { PlacePhoto } from './PlacePhoto'
import type { Origin, RouteMode, ViewPlace } from './types'

interface RouteState {
  status: 'loading' | 'done'
  route?: RouteResult
  elevation?: ElevationSummary | null
}

/**
 * 詳細ボトムシート（DESIGN §3.3）。経路と経路沿いの標高はここを開いたときだけ取得（R3）。
 * 距離・時間・上りはカードと同じ tripEstimate で計算（BACKLOG-2 D2）。経路が OSRM で取れたときだけ一覧へ反映（C3）。
 */
export function DetailSheet({
  place,
  origin,
  services,
  speedKmh,
  minutes,
  mode,
  onMode,
  rodeToday,
  rodeYesterday,
  stampKey,
  onRode,
  onGo,
  onToggleFavorite,
  onRouteResult,
  onClose,
}: {
  place: ViewPlace | null
  origin: Origin
  services: Services
  speedKmh: number
  minutes: number
  mode: RouteMode
  onMode: (m: RouteMode) => void
  rodeToday: boolean
  rodeYesterday: boolean
  /** 記録した瞬間にスタンプ演出を出すためのキー */
  stampKey: number
  onRode: (p: ViewPlace, when: 'today' | 'yesterday') => void
  onGo: (p: ViewPlace, mode: RouteMode, trip: TripEstimate) => void
  onToggleFavorite: (p: ViewPlace) => void
  /** 経路（OSRM）が取れたときだけ呼ぶ: 経路距離と経路沿いの標高を一覧にも反映（C3/D2） */
  onRouteResult: (id: string, r: { km: number; elevation: ElevationSummary | null }) => void
  onClose: () => void
}) {
  const [route, setRoute] = useState<RouteState>({ status: 'loading' })
  const [photo, setPhoto] = useState<PhotoInfo | null | undefined>(undefined)
  const id = place?.id
  // 出発地が仮（デモ地点）のときは往復を使わない（A6）
  const roundTripAllowed = origin.kind !== 'demo'
  const effectiveMode: RouteMode = roundTripAllowed ? mode : 'oneway'

  useEffect(() => {
    if (!place) return
    const ac = new AbortController()
    setRoute({ status: 'loading' })
    setPhoto(place.photo)
    services
      .routeDetail(origin, place, ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return
        setRoute({ status: 'done', route: r.route, elevation: r.elevation })
        if (r.route.source === 'osrm') onRouteResult(place.id, { km: r.route.distanceKm, elevation: r.elevation })
      })
      .catch(() => !ac.signal.aborted && setRoute({ status: 'done' }))
    services
      .photos([place], PHOTO_WIDTH_DETAIL, ac.signal)
      .then((m) => !ac.signal.aborted && m.has(place.id) && setPhoto(m.get(place.id) ?? null))
      .catch(() => {})
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, origin.lat, origin.lng, services])

  const routed = route.route?.source === 'osrm' || place?.routeKm !== undefined
  const trip = place
    ? tripEstimate(
        {
          distanceKm: place.distanceKm,
          routeKm: place.routeKm ?? (route.route?.source === 'osrm' ? route.route.distanceKm : undefined),
          // 経路が取れたら経路沿いの標高、取れなければ一覧と同じ推定値（カードと数字をそろえる）
          elevation: routed ? (route.elevation ?? place.elevation) : (place.elevation ?? route.elevation),
        },
        effectiveMode,
        speedKmh,
      )
    : null
  const flash = useFlash(trip?.routed ? trip.oneWayKm : undefined)
  if (!place || !trip) return null

  const cat = CATEGORY_META[place.category]
  const elev = routed ? (route.elevation ?? place.elevation) : (place.elevation ?? route.elevation ?? undefined)
  const round = effectiveMode === 'round'
  const overBudget = trip.routed && isRouteOverBudget(trip.oneWayKm, minutes, speedKmh)
  const demoData = place.source === 'mock'
  const href = buildDepartUrl({ mode: effectiveMode, start: origin, destination: place })
  const walkHref = buildDepartUrl({ mode: 'oneway', start: origin, destination: place, travelmode: 'walking' })
  const text = elev ? ELEVATION_TEXT[elev.label] : null

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={place.name}
      className="detail"
      hero={
        <div className="detail__photo">
          <PlacePhoto id={place.id} name={place.name} category={place.category} photo={photo} />
          <span className="cat-pill">
            <span aria-hidden="true">{cat.emoji}</span> {cat.label}
          </span>
          <button
            type="button"
            className={`detail__fav icon-btn pressable${place.favorite ? ' is-on' : ''}`}
            aria-pressed={place.favorite}
            aria-label={place.favorite ? 'お気に入りから外す' : 'お気に入りに追加'}
            onClick={() => onToggleFavorite(place)}
          >
            <HeartIcon filled={place.favorite} />
          </button>
          {stampKey > 0 && rodeToday && (
            <span key={stampKey} className="stamp-drop" aria-hidden="true">
              {cat.emoji}
            </span>
          )}
        </div>
      }
      footer={
        <>
          <a className="btn btn--primary detail__go pressable" href={href} target="_blank" rel="noopener" onClick={() => onGo(place, effectiveMode, trip)}>
            🚲 Googleマップで出発 <span className="arrow">→</span>
          </a>
          <div className="detail__sublinks">
            <a href={walkHref} target="_blank" rel="noopener">
              徒歩で開く
            </a>
            {demoData && <span className="demo-note">※ デモの架空の場所。実在しないかも</span>}
          </div>
        </>
      }
    >
      <div className="segment" role="radiogroup" aria-label="ルート">
        <button type="button" role="radio" aria-checked={!round} className={`segment__btn${!round ? ' is-on' : ''}`} onClick={() => onMode('oneway')}>
          片道で行く
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={round}
          disabled={!roundTripAllowed}
          className={`segment__btn${round ? ' is-on' : ''}`}
          onClick={() => onMode('round')}
        >
          往復でまわる
        </button>
      </div>
      {!roundTripAllowed && <p className="detail__muted">仮の出発地なので片道だけ</p>}

      <div className="stats" aria-live="polite">
        {flash && <RouteUpdatedPill />}
        <div className="stats__cell">
          <span className="stats__num num">
            <CountUp value={trip.km} decimals={1} />
            <small>km</small>
          </span>
          <span className="stats__label">{round ? '往復' : '片道'}</span>
        </div>
        <div className="stats__cell">
          <span className="stats__num num">
            <CountUp value={trip.minutes} />
            <small>分</small>
          </span>
          <span className="stats__label">{round ? '往復' : '片道'}の目安</span>
        </div>
        <div className={`stats__cell${elev ? ` stats__cell--${elev.label}` : ''}`}>
          <span className="stats__num num">
            {trip.gainM === null ? '—' : <>+<CountUp value={trip.gainM} /></>}
            <small>m</small>
          </span>
          <span className="stats__label">{round ? '往復の上り' : '行きの上り'}</span>
          {elev && text && (
            <span className="stats__sub">
              <ElevationIcon label={elev.label} size={12} />
              {round ? (
                <>
                  片道 <span className="num">+{trip.climbM}m</span> · {text.long}
                </>
              ) : (
                text.long
              )}
            </span>
          )}
        </div>
      </div>
      <p className="detail__note">
        ※ 滞在時間を含まない走行の目安{trip.routed ? '' : '（道のりは直線から推定）'}
      </p>
      {overBudget && (
        <p className="detail__warn" role="note">
          ⚠ 実際の道のりは{formatMinutesJa(minutes)}の目安より長め。時間に余裕をもってね
        </p>
      )}

      <section className="detail__section">
        <div className="detail__section-head">
          <h3>
            標高{text && <span className={`detail__elev-label detail__elev-label--${elev!.label}`}>{text.sub}</span>}
          </h3>
          {elev && !elev.estimated && <span className="num detail__grade">最大勾配 {Math.round(elev.maxGradePct)}%</span>}
        </div>
        {elev ? (
          <ElevationProfile summary={elev} roundTrip={round} straight={false} />
        ) : route.status === 'loading' ? (
          <div className="skeleton skeleton--profile" aria-hidden="true" />
        ) : (
          <p className="detail__muted">標高データを取れなかった</p>
        )}
      </section>

      <div className="detail__rode">
        <button type="button" className="btn btn--outline btn--block pressable" aria-pressed={rodeToday} onClick={() => onRode(place, 'today')}>
          {rodeToday ? '✓ 今日走った！' : '✓ 走った！'}
        </button>
        {!rodeToday && (
          <button type="button" className="btn btn--text detail__yesterday" aria-pressed={rodeYesterday} onClick={() => onRode(place, 'yesterday')}>
            {rodeYesterday ? '✓ 昨日の分を記録済み' : '昨日の分として記録'}
          </button>
        )}
      </div>
    </BottomSheet>
  )
}
