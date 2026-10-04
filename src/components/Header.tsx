import { GearIcon } from './Icons'

/** ストリークバッジ（0 日なら 🚲 のみ） */
export function StreakBadge({ streak, onClick, bump }: { streak: number; onClick: () => void; bump?: number }) {
  return (
    <button
      type="button"
      className={`streak-badge pressable${streak > 0 ? ' is-on' : ''}`}
      onClick={onClick}
      aria-label={streak > 0 ? `きろく。${streak}日連続` : 'きろく'}
    >
      <span key={bump} className="streak-badge__inner">
        {streak > 0 ? (
          <>
            🔥<span className="num">{streak}</span>
          </>
        ) : (
          '🚲'
        )}
      </span>
    </button>
  )
}

export function AppHeader({
  streak,
  bump,
  onRecords,
  onSettings,
}: {
  streak: number
  bump?: number
  onRecords: () => void
  onSettings: () => void
}) {
  return (
    <header className="app-header">
      <h1 className="app-header__logo">ちょいチャリ</h1>
      <div className="app-header__actions">
        <StreakBadge streak={streak} onClick={onRecords} bump={bump} />
        <button type="button" className="icon-btn pressable" onClick={onSettings} aria-label="設定">
          <GearIcon />
        </button>
      </div>
    </header>
  )
}
