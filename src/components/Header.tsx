import type { ReactNode } from 'react'
import { ChevronLeft, GearIcon } from './Icons'

/** ストリークバッジ（0 日なら 🚲 のみ） */
export function StreakBadge({ streak, onClick, bump }: { streak: number; onClick: () => void; bump?: number }) {
  return (
    <button
      type="button"
      className={`streak-badge pressable${streak > 0 ? ' is-on' : ''}`}
      onClick={onClick}
      aria-label={streak > 0 ? `きろく。${streak}日連続` : 'きろく'}
    >
      <span key={bump} className={`streak-badge__inner${bump ? ' is-bump' : ''}`}>
        {streak > 0 ? (
          <>
            <span aria-hidden="true">🔥</span>
            <span className="num">{streak}</span>
          </>
        ) : (
          <span aria-hidden="true">🚲</span>
        )}
      </span>
    </button>
  )
}

/**
 * ヘッダー（DESIGN §3.1/§3.2）。右は「きろく（🔥）」と「設定（⚙）」のみ。
 * 一覧では左に戻る＋条件サマリ、右に 🎲。
 */
export function AppHeader({
  streak,
  bump,
  onRecords,
  onSettings,
  onBack,
  summary,
  onGacha,
}: {
  streak: number
  bump?: number
  onRecords: () => void
  onSettings: () => void
  onBack?: () => void
  summary?: ReactNode
  onGacha?: () => void
}) {
  return (
    <header className={`app-header${onBack ? ' app-header--list' : ''}`}>
      {onBack ? (
        <button type="button" className="app-header__back pressable" onClick={onBack} aria-label="時間をえらび直す">
          <ChevronLeft />
          <span className="app-header__summary">{summary}</span>
        </button>
      ) : (
        <p className="app-header__logo">
          <span className="app-header__mark" aria-hidden="true" />
          ちょいチャリ
        </p>
      )}
      <div className="app-header__actions">
        {onGacha && (
          <button type="button" className="icon-btn pressable" onClick={onGacha} aria-label="おまかせ（ガチャ）">
            <span aria-hidden="true">🎲</span>
          </button>
        )}
        <StreakBadge streak={streak} onClick={onRecords} bump={bump} />
        <button type="button" className="icon-btn pressable" onClick={onSettings} aria-label="設定">
          <GearIcon />
        </button>
      </div>
    </header>
  )
}
