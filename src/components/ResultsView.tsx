import { useId, type ReactNode } from 'react'
import type { ObserveRef } from '../hooks/useEnrichment'
import type { SearchStatus } from '../hooks/usePlaceSearch'
import { useScrollDirection } from '../hooks/useScrollDirection'
import type { ElevationFilter, SortKey } from '../lib/candidates'
import type { TripEstimate } from '../lib/trip'
import type { Category } from '../lib/types'
import { DemoPill } from './Banners'
import { FilterBar, SortSelect } from './FilterBar'
import { PlaceCard } from './PlaceCard'
import { RecommendCard } from './RecommendCard'
import { EmptyState, LoadingBar, SkeletonCard } from './States'
import type { ViewPlace } from './types'

export interface FilterState {
  elevation: ElevationFilter
  categories: ReadonlySet<Category>
  sort: SortKey
}

/** 候補画面: 今日のおすすめ 3 件（カードから直接出発）＋「もっと見る」一覧（DESIGN §3.2 / BACKLOG 提案型） */
export function ResultsView({
  top,
  status,
  total,
  recs,
  list,
  showAll,
  onShowAll,
  filter,
  onFilter,
  available,
  isDemo,
  demoReason,
  demoMessage,
  fallback,
  tripOf,
  goHrefOf,
  goLabel,
  onGo,
  onOpen,
  onToggleFavorite,
  observe,
  onRetry,
  onAddTime,
  canAddTime,
  onChangeOrigin,
  onGacha,
}: {
  top?: ReactNode
  status: SearchStatus
  total: number
  recs: readonly ViewPlace[]
  list: readonly ViewPlace[]
  showAll: boolean
  onShowAll: () => void
  filter: FilterState
  onFilter: (f: FilterState) => void
  available: readonly Category[]
  isDemo: boolean
  demoReason?: string | null
  demoMessage?: string
  /** 実 API が失敗してデモに落ちている（?demo=1 ではない）。再試行ボタンを出し、カードから直接出発させない（C6） */
  fallback: boolean
  tripOf: (p: ViewPlace) => TripEstimate
  goHrefOf: (p: ViewPlace) => string
  goLabel: string
  onGo: (p: ViewPlace) => void
  onOpen: (p: ViewPlace) => void
  onToggleFavorite: (p: ViewPlace) => void
  observe: ObserveRef
  onRetry: () => void
  onAddTime: () => void
  canAddTime: boolean
  onChangeOrigin: () => void
  onGacha: () => void
}) {
  const recsTitle = useId()
  const moreTitle = useId()
  const filtered = filter.elevation !== 'all' || filter.categories.size > 0
  const reset = () => onFilter({ ...filter, elevation: 'all', categories: new Set() })
  const scrollingDown = useScrollDirection(showAll)
  const hasList = status !== 'idle' && status !== 'loading' && status !== 'error' && total > 0

  let body: ReactNode
  if (status === 'idle' || status === 'loading') {
    body = (
      <>
        <LoadingBar />
        <div className="card-grid">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </>
    )
  } else if (status === 'error') {
    body = (
      <EmptyState icon="🌧" title="電波がちょっと迷子みたい" body="つながったら、もう一度さがしてみよう">
        <button type="button" className="btn btn--primary pressable" onClick={onRetry}>
          もう一度さがす
        </button>
      </EmptyState>
    )
  } else if (total === 0) {
    body = (
      <EmptyState body={status === 'empty' ? 'このあたりは行き先が少ないみたい。時間をのばすか、出発地を変えてみよう' : undefined}>
        {canAddTime && (
          <button type="button" className="btn btn--primary pressable" onClick={onAddTime}>
            時間を +15分
          </button>
        )}
        <button type="button" className="btn btn--outline pressable" onClick={onChangeOrigin}>
          出発地を変える
        </button>
      </EmptyState>
    )
  } else {
    body = (
      <>
        <div className="count-line">
          <p>
            <strong className="num">{total}</strong>件の行き先
          </p>
          {isDemo && <DemoPill reason={demoReason} message={demoMessage} />}
          {fallback && (
            <button type="button" className="btn btn--text count-line__retry" onClick={onRetry}>
              実データでさがし直す
            </button>
          )}
        </div>
        <section className="recs" aria-labelledby={recsTitle}>
          <div className="section-head">
            <h2 id={recsTitle} className="section-head__title">
              今日のおすすめ
            </h2>
            <p className="section-head__sub">日替わり · まだ行ってない場所を優先</p>
          </div>
          <div className="recs__track">
            {recs.map((p, i) => (
              <RecommendCard
                key={p.id}
                place={p}
                rank={i + 1}
                trip={tripOf(p)}
                goHref={goHrefOf(p)}
                goLabel={goLabel}
                canDepart={!fallback}
                onGo={onGo}
                onOpen={onOpen}
                observe={observe}
              />
            ))}
          </div>
        </section>

        <section className="more" aria-labelledby={showAll ? moreTitle : undefined}>
          {!showAll ? (
            <button type="button" className="more__open btn btn--secondary btn--block pressable" onClick={onShowAll}>
              <span>
                もっと見る（<span className="num">{total}</span>件）
              </span>
            </button>
          ) : (
            <>
              <h2 id={moreTitle} className="section-head__title more__title">
                ぜんぶの行き先
              </h2>
              <FilterBar
                elevation={filter.elevation}
                onElevation={(elevation) => onFilter({ ...filter, elevation })}
                categories={filter.categories}
                available={available}
                onToggleCategory={(c) => {
                  const next = new Set(filter.categories)
                  if (next.has(c)) next.delete(c)
                  else next.add(c)
                  onFilter({ ...filter, categories: next })
                }}
              />
              <div className="count-line count-line--list">
                <p aria-live="polite">
                  <strong className="num">{list.length}</strong>件{filtered && <span className="count-line__of">（{total}件中）</span>}
                </p>
                {filtered && (
                  <button type="button" className="btn btn--text count-line__reset" onClick={reset}>
                    リセット
                  </button>
                )}
                <SortSelect sort={filter.sort} onSort={(sort) => onFilter({ ...filter, sort })} />
              </div>
              {list.length === 0 ? (
                <EmptyState>
                  <button type="button" className="btn btn--primary pressable" onClick={reset}>
                    フィルタをリセット
                  </button>
                  {canAddTime && (
                    <button type="button" className="btn btn--outline pressable" onClick={onAddTime}>
                      時間を +15分
                    </button>
                  )}
                </EmptyState>
              ) : (
                <div className="card-grid card-grid--list">
                  {list.map((p, i) => (
                    <PlaceCard
                      key={p.id}
                      place={p}
                      index={i}
                      trip={tripOf(p)}
                      onOpen={onOpen}
                      onToggleFavorite={onToggleFavorite}
                      observe={observe}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </>
    )
  }

  return (
    <main className="results" id="main">
      {top}
      {body}
      {/* FAB: おすすめだけ表示中は出さない。一覧では下スクロールで隠し、上スクロールで出す（D4） */}
      {hasList && showAll && (
        <button
          type="button"
          className={`fab pressable${scrollingDown ? ' is-hidden' : ''}`}
          onClick={onGacha}
          aria-label="おまかせ（ガチャ）"
          tabIndex={scrollingDown ? -1 : 0}
        >
          <span aria-hidden="true">🎲</span>
        </button>
      )}
    </main>
  )
}
