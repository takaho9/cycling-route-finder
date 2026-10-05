import { useId, type CSSProperties } from 'react'
import { CATEGORY_META, CATEGORY_ORDER } from '../lib/categories'
import { hashString } from '../lib/random'
import { toDateKey, weekActivity, type RideRecord } from '../lib/storage'
import { BottomSheet } from './BottomSheet'

const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日']

const mmdd = (key: string) => `${key.slice(5, 7)}/${key.slice(8, 10)}`

/** スタンプの「押した感」: ID ハッシュで -6〜6deg */
export const stampTilt = (id: string) => (hashString(id) % 13) - 6

/** きろくシート（DESIGN §3.5）: ストリーク・今週・目標・スタンプ帳・ベスト */
export function RecordsSheet({
  open,
  onClose,
  rides,
  stamps,
  streak,
  best,
  weekCount,
  weeklyGoal,
  today,
  onDeleteRide,
}: {
  open: boolean
  onClose: () => void
  rides: readonly RideRecord[]
  stamps: readonly RideRecord[]
  streak: number
  best: number
  weekCount: number
  weeklyGoal: number
  today: Date
  onDeleteRide: (placeId: string, date: string) => void
}) {
  const weekTitle = useId()
  const stampTitle = useId()
  const recentTitle = useId()
  const week = weekActivity(rides, today)
  const left = Math.max(0, weeklyGoal - weekCount)
  const todayKey = toDateKey(today)
  const goalDone = weekCount >= weeklyGoal
  const collected = new Set(stamps.map((s) => s.category ?? 'other'))
  const missing = CATEGORY_ORDER.filter((c) => c !== 'other' && !collected.has(c))
  const recent = [...rides].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 5)

  return (
    <BottomSheet open={open} onClose={onClose} title="きろく" snap="full" className="records">
      <div className="streak-hero">
        {streak > 0 ? (
          <>
            <p className="streak-hero__big">
              <span aria-hidden="true">🔥</span>
              <span className="num streak-hero__num">{streak}</span>
              <span className="streak-hero__unit">日連続！</span>
            </p>
            <p className="streak-hero__sub">いい流れ。明日もちょいと。</p>
          </>
        ) : (
          <>
            <p className="streak-hero__big streak-hero__big--rest">
              <span aria-hidden="true">🚲</span>
              <span className="streak-hero__unit">また今日からはじめよう</span>
            </p>
            <p className="streak-hero__sub">{best > 0 ? `ベストは${best}日。ちょいと走れば、また火がつくよ` : '1回走ると🔥がともるよ'}</p>
          </>
        )}
        {streak > 0 && best > 0 && (
          <p className="streak-hero__best">
            ベスト <span className="num">{best}</span>日
          </p>
        )}
      </div>

      <section className="rec-section" aria-labelledby={weekTitle}>
        <h3 id={weekTitle} className="rec-section__title">
          今週
        </h3>
        <ol className="week">
          {week.map((d, i) => {
            const state = d.rode === null ? 'future' : d.rode ? 'rode' : 'rest'
            return (
              <li
                key={d.date}
                className={`week__day week__day--${state}${d.date === todayKey ? ' is-today' : ''}`}
                aria-current={d.date === todayKey ? 'date' : undefined}
              >
                <span className="week__label">{WEEKDAYS[i]}</span>
                <span className="week__dot" aria-label={state === 'rode' ? '走った' : state === 'rest' ? 'お休み' : 'これから'} />
                {d.date === todayKey && <span className="week__today">今日</span>}
              </li>
            )
          })}
        </ol>
        <p className={`goal${goalDone ? ' is-done' : ''}`}>
          今週 <span className="num">{weekCount}</span>回 / 目標 <span className="num">{weeklyGoal}</span>回
          {goalDone && <span className="goal__done"> 🎉 今週の目標クリア えらすぎる</span>}
        </p>
        {!goalDone && (
          <p className={`goal__left${left === 1 ? ' is-close' : ''}`}>
            {left === 1 ? 'あと1回で目標クリア！' : `あと${left}回で目標クリア`}
          </p>
        )}
        <div
          className="goal__bar"
          role="progressbar"
          aria-label="今週の目標"
          aria-valuemin={0}
          aria-valuemax={weeklyGoal}
          aria-valuenow={Math.min(weekCount, weeklyGoal)}
        >
          <span style={{ width: `${Math.min(100, (weekCount / weeklyGoal) * 100)}%` }} />
        </div>
      </section>

      <section className="rec-section" aria-labelledby={stampTitle}>
        <h3 id={stampTitle} className="rec-section__title">
          スタンプ帳 <span className="num rec-section__count">{stamps.length}</span>か所
        </h3>
        <ul className="stamps">
          {stamps.map((s) => {
            const m = CATEGORY_META[s.category ?? 'other']
            return (
              <li key={s.placeId} className="stamp" style={{ '--stamp-c': m.from, '--tilt': `${stampTilt(s.placeId)}deg` } as CSSProperties}>
                <span className="stamp__seal" aria-hidden="true">
                  {m.emoji}
                </span>
                <span className="stamp__name">{s.name}</span>
                <span className="stamp__date num">{mmdd(s.date)}</span>
              </li>
            )
          })}
          {missing.map((c) => (
            <li key={c} className="stamp stamp--empty">
              <span className="stamp__seal" aria-hidden="true">
                ?
              </span>
              <span className="stamp__name">{CATEGORY_META[c].label}</span>
            </li>
          ))}
        </ul>
      </section>

      {recent.length > 0 && (
        <section className="rec-section" aria-labelledby={recentTitle}>
          <h3 id={recentTitle} className="rec-section__title">
            さいきんのライド
          </h3>
          <ul className="recent">
            {recent.map((r, i) => (
              <li key={`${r.placeId}-${r.date}-${i}`} className="recent__item">
                <span className="recent__date num">{mmdd(r.date)}</span>
                <span className="recent__name">
                  <span aria-hidden="true">{CATEGORY_META[r.category ?? 'other'].emoji}</span> {r.name}
                </span>
                <button type="button" className="btn btn--text recent__del" onClick={() => onDeleteRide(r.placeId, r.date)}>
                  取り消す
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </BottomSheet>
  )
}
