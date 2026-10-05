import { useEffect, useId, useState } from 'react'
import { CREDITS, NON_COMMERCIAL_NOTE, PRIVACY_DESTINATIONS, PRIVACY_SUMMARY } from '../lib/credits'
import type { StaticIndex } from '../lib/places/staticData'
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
  loadDataInfo,
}: {
  open: boolean
  onClose: () => void
  speed: SpeedPresetId
  onSpeed: (s: SpeedPresetId) => void
  weeklyGoal: number
  onWeeklyGoal: (n: number) => void
  origin: Origin | null
  onChangeOrigin: () => void
  /** 事前生成データの index.json を読む（v1.3） */
  loadDataInfo?: () => Promise<StaticIndex | null>
}) {
  const ids = { speed: useId(), goal: useId(), origin: useId(), credit: useId(), privacy: useId() }
  const [dataInfo, setDataInfo] = useState<StaticIndex | null>(null)
  useEffect(() => {
    if (!open || !loadDataInfo) return
    let alive = true
    loadDataInfo()
      .then((d) => alive && setDataInfo(d))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [open, loadDataInfo])
  return (
    <BottomSheet open={open} onClose={onClose} title="設定" snap="full" className="settings">
      <section className="set-section" aria-labelledby={ids.speed}>
        <h3 id={ids.speed} className="set-section__title">
          はやさ
        </h3>
        <p className="set-section__desc">だいたいの巡航スピードを選んでね</p>
        <div className="speed-options" role="radiogroup" aria-labelledby={ids.speed}>
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

      <section className="set-section" aria-labelledby={ids.goal}>
        <h3 id={ids.goal} className="set-section__title">
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

      <section className="set-section" aria-labelledby={ids.origin}>
        <h3 id={ids.origin} className="set-section__title">
          出発地
        </h3>
        <button type="button" className="set-row pressable" onClick={onChangeOrigin}>
          <span>📍 {origin ? origin.label : '未設定'}</span>
          <span className="set-row__go">
            変更 <ChevronRight size={14} />
          </span>
        </button>
      </section>

      {/* クレジットは折りたたみ（BACKLOG-2 D19）。中身は常に DOM にあり、展開すると読める */}
      <section className="set-section" aria-labelledby={ids.credit}>
        <details className="credits-details">
          <summary className="set-section__title credits-details__summary">
            <span id={ids.credit}>クレジット</span>
            <span className="credits-details__hint">OpenStreetMap・Open-Meteo ほか</span>
          </summary>
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
          {dataInfo && <DataInfo info={dataInfo} />}
        </details>
      </section>

      <section className="set-section" aria-labelledby={ids.privacy}>
        <h3 id={ids.privacy} className="set-section__title">
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

/** 都内の事前生成データの生成日時とデータ源（v1.3） */
export function formatGeneratedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function DataInfo({ info }: { info: StaticIndex }) {
  return (
    <div className="data-info">
      <p className="data-info__title">
        {info.region}の行き先データ{info.sample && <span className="data-info__sample">（サンプル）</span>}
      </p>
      <p className="data-info__meta">
        <span className="num">{formatGeneratedAt(info.generatedAt)}</span> 生成 · <span className="num">{info.count.toLocaleString('ja-JP')}</span> か所
      </p>
      <ul className="credits">
        {info.sources.map((s) => (
          <li key={s.name}>
            <span className="credits__role">{s.license}</span>
            <a href={s.url} target="_blank" rel="noopener">
              {s.name}
            </a>
          </li>
        ))}
      </ul>
      <p className="data-info__note">都外は OpenStreetMap（Overpass API）からその場で取得するよ</p>
    </div>
  )
}
