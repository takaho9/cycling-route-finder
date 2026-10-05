import type { ReactNode } from 'react'
import type { ElevationFilter, SortKey } from '../lib/candidates'
import type { Category } from '../lib/types'
import type { SearchStatus } from '../hooks/usePlaceSearch'
import { DemoPill } from './Banners'
import { FilterBar } from './FilterBar'
import { PlaceCard, type CardMetrics } from './PlaceCard'
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
  metricsOf,
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
  metricsOf: (p: ViewPlace) => CardMetrics
  goHrefOf: (p: ViewPlace) => string
  goLabel: string
  onGo: (p: ViewPlace) => void
  onOpen: (p: ViewPlace) => void
  onToggleFavorite: (p: ViewPlace) => void
  observe: (el: HTMLElement | null) => void
  onRetry: () => void
  onAddTime: () => void
  canAddTime: boolean
  onChangeOrigin: () => void
}) {
  const filtered = filter.elevation !== 'all' || filter.categories.size > 0
  const reset = () => onFilter({ ...filter, elevation: 'all', categories: new Set() })

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
        <p className="count-line">
          <span>
            <strong className="num">{total}</strong>件の行き先が見つかった
          </span>
          {isDemo && <DemoPill reason={demoReason} />}
        </p>
        <section className="recs" aria-labelledby="recs-title">
          <div className="section-head">
            <h2 id="recs-title" className="section-head__title">
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
                metrics={metricsOf(p)}
                goHref={goHrefOf(p)}
                goLabel={goLabel}
                demo={p.source === 'mock'}
                onGo={onGo}
                onOpen={onOpen}
                observe={observe}
              />
            ))}
          </div>
        </section>

        <section className="more" aria-labelledby="more-title">
          {!showAll ? (
            <button type="button" className="more__open btn btn--secondary btn--block pressable" onClick={onShowAll}>
              もっと見る（全<span className="num">{total}</span>件）
            </button>
          ) : (
            <>
              <h2 id="more-title" className="section-head__title more__title">
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
                sort={filter.sort}
                onSort={(sort) => onFilter({ ...filter, sort })}
              />
              <p className="count-line count-line--list" aria-live="polite">
                <span>
                  <strong className="num">{list.length}</strong>件{filtered ? `（全${total}件中）` : ''}
                </span>
                {filtered && (
                  <button type="button" className="btn btn--text count-line__reset" onClick={reset}>
                    リセット
                  </button>
                )}
              </p>
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
                <div className="card-grid">
                  {list.map((p, i) => (
                    <PlaceCard
                      key={p.id}
                      place={p}
                      index={i}
                      metrics={metricsOf(p)}
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
    </main>
  )
}
