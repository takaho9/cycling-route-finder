import { CREDITS, NON_COMMERCIAL_NOTE, PRIVACY_DESTINATIONS, PRIVACY_SUMMARY } from '../lib/credits'
import { SPEED_PRESETS, type SpeedPresetId } from '../lib/reach'
import { BottomSheet } from './BottomSheet'
import { ChevronRight } from './Icons'
import type { Origin } from './types'

/** 設定（速度・週目標・出発地・クレジット・プライバシー, BACKLOG R8/A9） */
export function SettingsSheet({
  open,
  onClose,
  speed,
  onSpeed,
  weeklyGoal,
  onWeeklyGoal,
  origin,
  onChangeOrigin,
}: {
  open: boolean
  onClose: () => void
  speed: SpeedPresetId
  onSpeed: (s: SpeedPresetId) => void
  weeklyGoal: number
  onWeeklyGoal: (n: number) => void
  origin: Origin | null
  onChangeOrigin: () => void
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title="設定" snap="full" className="settings">
      <section className="set-section" aria-labelledby="speed-title">
        <h3 id="speed-title" className="set-section__title">
          はやさ
        </h3>
        <p className="set-section__desc">だいたいの巡航スピードを選んでね</p>
        <div className="speed-options" role="radiogroup" aria-labelledby="speed-title">
          {Object.values(SPEED_PRESETS).map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={speed === p.id}
              className={`speed-option pressable${speed === p.id ? ' is-on' : ''}`}
              onClick={() => onSpeed(p.id)}
            >
              <span className="speed-option__label">{p.label}</span>
              <span className="speed-option__kmh num">
                {p.kmh}
                <small>km/h</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="set-section" aria-labelledby="goal-title">
        <h3 id="goal-title" className="set-section__title">
          週の目標
        </h3>
        <div className="stepper">
          <button
            type="button"
            className="stepper__btn pressable"
            onClick={() => onWeeklyGoal(Math.max(1, weeklyGoal - 1))}
            disabled={weeklyGoal <= 1}
            aria-label="目標を1回へらす"
          >
            −
          </button>
          <output className="stepper__value" aria-live="polite">
            週 <span className="num">{weeklyGoal}</span> 回
          </output>
          <button
            type="button"
            className="stepper__btn pressable"
            onClick={() => onWeeklyGoal(Math.min(7, weeklyGoal + 1))}
            disabled={weeklyGoal >= 7}
            aria-label="目標を1回ふやす"
          >
            ＋
          </button>
        </div>
      </section>

      <section className="set-section" aria-labelledby="origin-title">
        <h3 id="origin-title" className="set-section__title">
          出発地
        </h3>
        <button type="button" className="set-row pressable" onClick={onChangeOrigin}>
          <span>📍 {origin ? origin.label : '未設定'}</span>
          <span className="set-row__go">
            変更 <ChevronRight size={14} />
          </span>
        </button>
      </section>

      <section className="set-section" aria-labelledby="credit-title">
        <h3 id="credit-title" className="set-section__title">
          クレジット
        </h3>
        <ul className="credits">
          {CREDITS.map((c) => (
            <li key={c.role}>
              <span className="credits__role">{c.role}</span>
              <a href={c.href} target="_blank" rel="noopener">
                {c.text}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="set-section" aria-labelledby="privacy-title">
        <h3 id="privacy-title" className="set-section__title">
          プライバシー
        </h3>
        <p className="set-section__desc">{PRIVACY_SUMMARY}</p>
        <ul className="privacy">
          {PRIVACY_DESTINATIONS.map((d) => (
            <li key={d.host}>
              <span className="privacy__host">{d.host}</span>
              <span className="privacy__what">{d.what}</span>
            </li>
          ))}
        </ul>
        <p className="set-section__note">{NON_COMMERCIAL_NOTE}</p>
      </section>
      <p className="settings__version">ちょいチャリ v{__APP_VERSION__}</p>
    </BottomSheet>
  )
}
