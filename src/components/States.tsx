import type { ReactNode } from 'react'

export function EmptyState({
  title = 'この条件だと見つからなかった',
  body = '時間をのばすか、フィルタをゆるめてみよう',
  icon = '🧭',
  children,
}: {
  title?: string
  body?: string
  icon?: string
  children?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty__art" aria-hidden="true">
        <span className="empty__ring" />
        <span className="empty__icon">{icon}</span>
      </div>
      <h3 className="empty__title">{title}</h3>
      <p className="empty__body">{body}</p>
      <div className="empty__actions">{children}</div>
    </div>
  )
}

export function SkeletonCard() {
  return (
    <div className="card card--skeleton" aria-hidden="true">
      <div className="card__photo skeleton" />
      <div className="card__band">
        <span className="skeleton skeleton--pill" />
        <span className="skeleton skeleton--graph" />
      </div>
    </div>
  )
}

export function LoadingBar({ label = '近くの行き先をさがし中… 🚲' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <div className="loading__bar" aria-hidden="true" />
      <p className="loading__text">{label}</p>
    </div>
  )
}
