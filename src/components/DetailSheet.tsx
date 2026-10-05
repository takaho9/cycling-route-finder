import { useEffect, useState } from 'react'
import { CATEGORY_META } from '../lib/categories'
import { buildOneWayUrl, buildRoundTripUrl } from '../lib/gmaps'
import { PHOTO_WIDTH_DETAIL, type PhotoInfo } from '../lib/photos'
import { estimateRoundTripMin, formatMinutesJa, isRouteOverBudget, roadKmEstimate } from '../lib/reach'
import type { RouteResult } from '../lib/routing'
import type { Services } from '../lib/services'
import type { ElevationSummary, LatLng } from '../lib/types'
import { BottomSheet } from './BottomSheet'
import { ELEVATION_TEXT, ElevationProfile } from './Elevation'
import { ElevationIcon, HeartIcon } from './Icons'
import { PlacePhoto } from './PlacePhoto'
import type { RouteMode, ViewPlace } from './types'

interface RouteState {
  status: 'loading' | 'done'
  route?: RouteResult
  elevation?: ElevationSummary | null
}

/** 詳細ボトムシート（DESIGN §3.3）。経路と経路沿いの標高はここを開いたときだけ取得（R3） */
export function DetailSheet({
  place,
  origin,
  roundTripAllowed,
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
  onRouteElevation,
  onClose,
}: {
  place: ViewPlace | null
  origin: LatLng
  /** 出発地が仮（デモ地点）のときは false（A6） */
  roundTripAllowed: boolean
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
  onGo: (p: ViewPlace, mode: RouteMode) => void
  onToggleFavorite: (p: ViewPlace) => void
  onRouteElevation: (id: string, s: ElevationSummary | null) => void
  onClose: () => void
}) {
  const [route, setRoute] = useState<RouteState>({ status: 'loading' })
  const [photo, setPhoto] = useState<PhotoInfo | null | undefined>(undefined)
  const id = place?.id
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
        onRouteElevation(place.id, r.elevation)
      })
      .catch(() => !ac.signal.aborted && setRoute({ status: 'done' }))
    services
      .photos([place], PHOTO_WIDTH_DETAIL, ac.signal)
      .then((m) => !ac.signal.aborted && m.has(place.id) && setPhoto(m.get(place.id) ?? null))
      .catch(() => {})
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, origin.lat, origin.lng, services])

  if (!place) return null
  const cat = CATEGORY_META[place.category]
  const elev = route.elevation ?? place.elevation
  const routed = route.route?.source === 'osrm'
  // 経路が取れたときだけ実距離。直線フォールバック時は一覧と同じく迂回係数を掛けた目安にそろえる
  const oneWayKm = routed && route.route ? route.route.distanceKm : roadKmEstimate(place.distanceKm)
  const round = effectiveMode === 'round'
  const km = round ? oneWayKm * 2 : oneWayKm
  const gain = elev ? (round ? elev.gainRoundTripM : elev.climbM) : null
  const roundMin = estimateRoundTripMin(oneWayKm, speedKmh, { routed: true, gainRoundTripM: elev?.gainRoundTripM ?? 0 })
  const min = round ? roundMin : (oneWayKm / speedKmh) * 60 + ((elev?.gainOneWayM ?? 0) / 10) * 0.5
  const overBudget = routed && isRouteOverBudget(oneWayKm, minutes, speedKmh)
  const demoData = place.source === 'mock'
  const href = round ? buildRoundTripUrl({ start: origin, destination: place }) : buildOneWayUrl({ destination: place })
  const walkHref = buildOneWayUrl({ destination: place, travelmode: 'walking' })

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
          <a className="btn btn--primary detail__go pressable" href={href} target="_blank" rel="noopener" onClick={() => onGo(place, effectiveMode)}>
            🚲 Googleマップで出発 <span className="arrow">→</span>
          </a>
          <div className="detail__sublinks">
            <a href={walkHref} target="_blank" rel="noopener">
              徒歩で開く
            </a>
            {demoData && <span className="demo-note">※ デモの架空の場所だよ。実在しないかも</span>}
          </div>
        </>
      }
    >
      <div className="stats" aria-live="polite">
        <div className="stats__cell">
          <span className="stats__num num">
            {route.status === 'loading' ? '…' : km.toFixed(1)}
            <small>km</small>
          </span>
          <span className="stats__label">{round ? '往復' : '片道'}</span>
        </div>
        <div className="stats__cell">
          <span className="stats__num num">
            {route.status === 'loading' ? '…' : Math.round(min)}
            <small>分</small>
          </span>
          <span className="stats__label">{round ? '往復' : '片道'}の走行目安</span>
        </div>
        <div className={`stats__cell${elev ? ` stats__cell--${elev.label}` : ''}`}>
          <span className="stats__num num">
            {gain === null ? '—' : `+${Math.round(gain)}`}
            <small>m</small>
          </span>
          <span className="stats__label">
            {elev ? (
              <>
                <ElevationIcon label={elev.label} size={12} /> {ELEVATION_TEXT[elev.label].long}
              </>
            ) : (
              '獲得標高'
            )}
          </span>
        </div>
      </div>
      <p className="detail__note">
        ※ 滞在時間は含まない走行時間の目安（上り10mごとに+0.5分）
        {route.route && !routed && route.status === 'done' && ' · 経路が取れなかったので直線から推定'}
      </p>
      {overBudget && (
        <p className="detail__warn" role="note">
          ⚠ 実際の道のりは{formatMinutesJa(minutes)}の目安より長め（約{oneWayKm.toFixed(1)}km）。時間に余裕をもってね
        </p>
      )}

      <section className="detail__section">
        <div className="detail__section-head">
          <h3>標高プロファイル</h3>
          {elev && !elev.estimated && <span className="num">最大勾配 {Math.round(elev.maxGradePct)}%</span>}
        </div>
        {elev ? (
          <>
            <ElevationProfile summary={elev} roundTrip={round} straight={!routed} />
            <p className="detail__elev-sub">{ELEVATION_TEXT[elev.label].sub}</p>
          </>
        ) : route.status === 'loading' ? (
          <div className="skeleton skeleton--profile" aria-hidden="true" />
        ) : (
          <p className="detail__muted">標高データを取れなかった</p>
        )}
      </section>

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
      {!roundTripAllowed && <p className="detail__muted">出発地が仮の地点なので、往復ルートはお休み。片道で開くね</p>}

      <div className="detail__rode">
        <button
          type="button"
          className="btn btn--outline pressable"
          aria-pressed={rodeToday}
          onClick={() => onRode(place, 'today')}
        >
          {rodeToday ? '✓ 今日走った！' : '✓ 走った！'}
        </button>
        {!rodeToday && (
          <button type="button" className="btn btn--text pressable" aria-pressed={rodeYesterday} onClick={() => onRode(place, 'yesterday')}>
            {rodeYesterday ? '✓ 昨日の分を記録済み' : '昨日の分として記録'}
          </button>
        )}
      </div>
    </BottomSheet>
  )
}
