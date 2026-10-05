import { PARTIAL_COVERAGE_NOTE } from '../lib/places'
import type { ReactNode } from 'react'
import type { LocateError, LocateStatus } from '../hooks/useOrigin'
import { formatMinutesJa, ROUND_TRIP_MINUTES, SPEED_PRESETS, type SpeedPresetId } from '../lib/reach'
import type { DaylightStatus } from '../lib/sun'
import type { Category } from '../lib/types'
import { DaylightChip, LocationNotice, LocationPill } from './Banners'
import { ChevronRight } from './Icons'
import { ReachRings } from './ReachRings'
import { TimeDial } from './TimeDial'
import type { Origin } from './types'

/** ホーム — タイムダイヤル（DESIGN §3.1 / BACKLOG-2 D8） */
export function HomeView({
  top,
  origin,
  locStatus,
  locError,
  onChangeOrigin,
  onDemoOrigin,
  onRetryLocate,
  index,
  onIndex,
  oneWayKm,
  speed,
  onSpeedTap,
  daylight,
  firstRun,
  demo,
  categories,
  count,
  isDemo,
  partialCoverage = false,
}: {
  /** 「行ってきた？」帯など最上部に出すもの */
  top?: ReactNode
  origin: Origin | null
  locStatus: LocateStatus
  locError: LocateError | null
  onChangeOrigin: () => void
  onDemoOrigin: () => void
  onRetryLocate: () => void
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
  /** いまの時間で行ける候補にあるカテゴリ（多い順） */
  categories: readonly Category[]
  /** いまの時間で行ける候補の数（未取得なら null） */
  count: number | null
  isDemo: boolean
  /** 検索円の 30% 以上が都外（事前生成データの対象外, v1.4 Q10） */
  partialCoverage?: boolean
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
      {needsOrigin && <LocationNotice error={locError} onChoose={onChangeOrigin} onDemo={onDemoOrigin} onRetry={onRetryLocate} />}
      <div className="home__head">
        <h1 className="home__title">今日は どこまで行く？</h1>
        {firstRun && <p className="home__lead">時間をえらぶだけ。あとは漕ぎだそう。</p>}
      </div>
      {/* 出発地が未確定のときは案内カードを優先し、レンジは出さない（ダイヤルを CTA の上に収めるため） */}
      {!needsOrigin && (
        <div className="home__reach-art">
          <ReachRings index={index} max={ROUND_TRIP_MINUTES.length - 1} categories={categories} />
          {count !== null && count > 0 && (
            <p className="home__count">
              この範囲に<span className="num">{count}</span>か所{isDemo && <span className="home__count-demo">（デモ）</span>}
              {partialCoverage && <span className="home__count-demo">（{PARTIAL_COVERAGE_NOTE}）</span>}
            </p>
          )}
        </div>
      )}
      <div className="home__dial">
        <p className="home__reach">
          <span>
            片道 およそ<strong className="num">{kmText}</strong>km 先まで
          </span>
          <button type="button" className="speed-link pressable" onClick={onSpeedTap}>
            {preset.label}
            <span className="num">{preset.kmh}km/h</span>
            <ChevronRight size={14} />
          </button>
        </p>
        <TimeDial index={index} onChange={onIndex} valueText={`${formatMinutesJa(minutes)}、片道約${kmText}km`} />
      </div>
    </main>
  )
}
