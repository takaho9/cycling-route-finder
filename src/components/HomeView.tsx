import type { ReactNode } from 'react'
import type { LocateStatus } from '../hooks/useOrigin'
import { formatMinutesJa, ROUND_TRIP_MINUTES, SPEED_PRESETS, type SpeedPresetId } from '../lib/reach'
import type { DaylightStatus } from '../lib/sun'
import { DaylightChip, LocationNotice, LocationPill } from './Banners'
import { ChevronRight } from './Icons'
import { ReachRings } from './ReachRings'
import { TimeDial } from './TimeDial'
import type { Origin } from './types'

/** ホーム — タイムダイヤル（DESIGN §3.1） */
export function HomeView({
  top,
  origin,
  locStatus,
  onChangeOrigin,
  onDemoOrigin,
  index,
  onIndex,
  oneWayKm,
  speed,
  onSpeedTap,
  daylight,
  firstRun,
  demo,
}: {
  /** 「行ってきた？」カードなど最上部に出すもの */
  top?: ReactNode
  origin: Origin | null
  locStatus: LocateStatus
  onChangeOrigin: () => void
  onDemoOrigin: () => void
  index: number
  onIndex: (i: number) => void
  /** 片道の走行距離の目安 (km) */
  oneWayKm: number
  speed: SpeedPresetId
  onSpeedTap: () => void
  daylight: DaylightStatus | null
  firstRun: boolean
  /** デモデータ表示（ピル） */
  demo?: ReactNode
}) {
  const needsOrigin = !origin && locStatus === 'denied'
  const minutes = ROUND_TRIP_MINUTES[index]
  const preset = SPEED_PRESETS[speed]
  const kmText = oneWayKm.toFixed(1)
  return (
    <main className="home" id="main">
      {top}
      <div className="home__loc">
        <LocationPill origin={origin} status={locStatus} onChange={onChangeOrigin} />
        {(daylight || demo) && (
          <div className="home__meta">
            {daylight && <DaylightChip status={daylight} minutes={minutes} />}
            {demo}
          </div>
        )}
      </div>
      {needsOrigin && <LocationNotice onChoose={onChangeOrigin} onDemo={onDemoOrigin} />}
      <div className="home__head">
        <h1 className="home__title">今日は どこまで行く？</h1>
        {firstRun && <p className="home__lead">時間をえらぶだけ。あとは漕ぎだそう。</p>}
      </div>
      {!needsOrigin && <ReachRings index={index} max={ROUND_TRIP_MINUTES.length - 1} />}
      <p className="home__reach">
        片道 およそ <strong className="num">{kmText}</strong>km 先まで
      </p>
      <TimeDial index={index} onChange={onIndex} valueText={`${formatMinutesJa(minutes)}、片道約${kmText}km`} />
      <button type="button" className="speed-link pressable" onClick={onSpeedTap}>
        {preset.label} <span className="num">{preset.kmh}km/h</span>
        <ChevronRight size={14} />
      </button>
    </main>
  )
}
