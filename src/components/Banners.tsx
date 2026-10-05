import { useEffect, useId, useRef, useState } from 'react'
import { formatMinutesJa } from '../lib/reach'
import type { DaylightStatus } from '../lib/sun'
import { POOR_ACCURACY_M, type LocateStatus } from '../hooks/useOrigin'
import { ChevronRight, PinIcon } from './Icons'
import type { Origin } from './types'

/** オフライン帯（DESIGN §3.6） */
export function OfflineStrip({ stale }: { stale: boolean }) {
  return (
    <div className="offline-strip" role="status">
      オフライン中{stale ? ' · 前回の候補を表示中' : ''}
    </div>
  )
}

/** 現在地ピル（タップで手動変更）。仮の出発地・低精度は gold 縁取り */
export function LocationPill({ origin, status, onChange }: { origin: Origin | null; status: LocateStatus; onChange: () => void }) {
  const poor = origin?.kind === 'gps' && (origin.accuracyM ?? 0) > POOR_ACCURACY_M
  const warn = origin?.kind === 'demo' || poor || (!origin && status === 'denied')
  let label: string
  if (!origin) label = status === 'locating' ? '現在地をさがし中…' : '出発地をえらんでね'
  else if (origin.kind === 'demo') label = `${origin.label}（仮の出発地）`
  else label = origin.label
  return (
    <button type="button" className={`loc-pill pressable${warn ? ' is-warn' : ''}`} onClick={onChange}>
      <PinIcon size={18} className="loc-pill__icon" />
      <span className="loc-pill__label">
        {label}
        {poor && <span className="loc-pill__acc"> · 位置がおおまか（±{(origin!.accuracyM! / 1000).toFixed(1)}km）</span>}
      </span>
      <span className="loc-pill__change">
        変更
        <ChevronRight size={14} />
      </span>
    </button>
  )
}

/** 位置情報オフ時のインラインカード（Y6: 自動で東京駅を検索しない） */
export function LocationNotice({ onChoose, onDemo }: { onChoose: () => void; onDemo: () => void }) {
  return (
    <section className="notice-card" aria-labelledby="loc-notice-title">
      <p id="loc-notice-title" className="notice-card__title">
        位置情報がオフみたい。出発地をえらぼう
      </p>
      <p className="notice-card__body">駅名や住所でさがせるよ。まず試すだけなら東京駅からでも OK。</p>
      <div className="notice-card__actions">
        <button type="button" className="btn btn--accent pressable" onClick={onChoose}>
          出発地を選ぶ
        </button>
        <button type="button" className="btn btn--outline pressable" onClick={onDemo}>
          デモで試す（東京駅）
        </button>
      </div>
    </section>
  )
}

/** 日没までの残り時間（ローカル計算, BACKLOG） */
export function DaylightChip({ status, minutes }: { status: DaylightStatus; minutes: number }) {
  if (status.kind === 'unknown') return null
  if (status.kind === 'night') {
    return (
      <p className="sun-chip sun-chip--night">
        <span aria-hidden="true">🌙</span> もう日が沈んでるよ。ライトをつけて安全に
      </p>
    )
  }
  const left = status.minutesToSunset
  return (
    <p className={`sun-chip${status.returnsAfterSunset ? ' sun-chip--warn' : ''}`}>
      <span aria-hidden="true">🌇</span> 日没まであと<span className="num">{formatMinutesJa(left)}</span>
      {status.returnsAfterSunset && <span className="sun-chip__warn"> · {formatMinutesJa(minutes)}だと暗くなるかも。ライトを忘れずに</span>}
    </p>
  )
}

/** デモデータ ピル＋説明ポップオーバー（DESIGN §3.6） */
export function DemoPill({ reason }: { reason?: string | null }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <span className="demo-pill-wrap" ref={ref}>
      <button type="button" className="demo-pill" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <span aria-hidden="true">ℹ</span> デモデータ
      </button>
      {open && (
        <span id={id} className="demo-pop" role="note">
          いまはサンプルの行き先を表示中。電波やAPIが戻ると実データになるよ
          {reason && <span className="demo-pop__reason">{reason}</span>}
        </span>
      )}
    </span>
  )
}
