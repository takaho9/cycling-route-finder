import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { DemoPill, OfflineStrip } from './components/Banners'
import { DetailSheet } from './components/DetailSheet'
import { GachaOverlay } from './components/GachaOverlay'
import { AppHeader } from './components/Header'
import { HomeView } from './components/HomeView'
import { OriginSheet } from './components/OriginSheet'
import { RecordsSheet } from './components/RecordsSheet'
import { ResultsView, type FilterState } from './components/ResultsView'
import { ReturnCard } from './components/ReturnCard'
import { SettingsSheet } from './components/SettingsSheet'
import { Toast, type ToastMsg } from './components/Toast'
import type { RouteMode, ViewPlace } from './components/types'
import { useEnrichment, useVisibility } from './hooks/useEnrichment'
import { rideToast, useHabits, type RidePlace } from './hooks/useHabits'
import { useOnline, useReducedMotion, vibrate } from './hooks/useMedia'
import { useNow } from './hooks/useNow'
import { DEMO_ORIGIN, useOrigin } from './hooks/useOrigin'
import { usePlaceSearch } from './hooks/usePlaceSearch'
import { useStableRecommendations } from './hooks/useRecommendations'
import { categoriesIn, filterAndSort, recommendationKey, selectCandidates } from './lib/candidates'
import { buildDepartUrl, buildOneWayUrl } from './lib/gmaps'
import { FALLBACK_MESSAGES } from './lib/places'
import { formatMinutesJa, roadBudgetKm, ROUND_TRIP_MINUTES, SPEED_PRESETS } from './lib/reach'
import { demoServices, isDemoMode, realServices, type Services } from './lib/services'
import { loadFlag, loadSettings, saveSettings, setFlag, shouldAskReturn, type Settings } from './lib/storage'
import { daylightStatus } from './lib/sun'
import { getUpdateReady, subscribeUpdate } from './lib/swUpdate'
import { tripEstimate, type TripEstimate } from './lib/trip'
import type { Category, ElevationSummary } from './lib/types'

type Screen = 'home' | 'results'
type SheetKind = 'records' | 'settings' | 'origin' | null

const DEFAULT_FILTER: FilterState = { elevation: 'all', categories: new Set(), sort: 'near' }

function indexOfMinutes(min: number): number {
  const i = ROUND_TRIP_MINUTES.indexOf(min as (typeof ROUND_TRIP_MINUTES)[number])
  return i >= 0 ? i : 2
}

const systemNow = () => new Date()

/** 候補に多いカテゴリ順（ホームの到達レンジに出す, D8） */
function topCategories(places: readonly { category: Category }[], n = 6): Category[] {
  const count = new Map<Category, number>()
  for (const p of places) count.set(p.category, (count.get(p.category) ?? 0) + 1)
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([c]) => c)
}

export default function App({ services: injected, now: clock = systemNow }: { services?: Services; now?: () => Date } = {}) {
  const services = useMemo(() => injected ?? (isDemoMode() ? demoServices : realServices), [injected])
  const reduced = useReducedMotion()
  const online = useOnline()
  // 帰還カード・日没・おすすめの日付・期限切れはすべてこの「いま」から（C4）
  const now = useNow(clock)

  // ---- settings
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch }
      saveSettings(next)
      return next
    })
  }, [])
  const kmh = SPEED_PRESETS[settings.speedPreset].kmh
  const index = indexOfMinutes(settings.lastMinutes)
  const minutes = ROUND_TRIP_MINUTES[index]
  const [firstRun] = useState(() => !loadFlag('welcomed'))
  useEffect(() => setFlag('welcomed'), [])

  // ---- origin / search / enrichment
  const { origin, status: locStatus, error: locError, locate, choose } = useOrigin(services)
  const search = usePlaceSearch(services, origin, online, kmh)
  const all = search.result?.places
  const candidates = useMemo(() => (all ? selectCandidates(all, minutes, kmh) : []), [all, minutes, kmh])
  const { elevations, photos, routeKm, markVisible, setRouteResult } = useEnrichment(services, origin, candidates)
  const observe = useVisibility(markVisible)

  // ---- habits
  const habits = useHabits(settings.weeklyGoal, clock, now)
  const [bump, setBump] = useState(0)
  const [stampKey, setStampKey] = useState(0)

  const views: ViewPlace[] = useMemo(
    () =>
      candidates.map((p) => {
        const e = elevations.get(p.id)
        const elevation: ElevationSummary | undefined = e ?? p.elevation
        return {
          ...p,
          elevation,
          elevationState: elevation ? 'ready' : elevations.has(p.id) ? 'none' : 'loading',
          photo: photos.has(p.id) ? (photos.get(p.id) ?? null) : undefined,
          routeKm: routeKm.get(p.id),
          visited: habits.visited.has(p.id),
          favorite: habits.favoriteIds.has(p.id),
        }
      }),
    [candidates, elevations, photos, routeKm, habits.visited, habits.favoriteIds],
  )
  const viewsById = useMemo(() => new Map(views.map((v) => [v.id, v])), [views])

  // ---- filter / list
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER)
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31))
  const list = useMemo(() => filterAndSort(views, { ...filter, visited: habits.visited, seed }), [views, filter, habits.visited, seed])
  // おすすめは「日付+時間+出発地+速度」で固定。標高が届いても並び替えない（C7）
  const recKey = recommendationKey({ dateKey: habits.todayKey, minutes, origin, speedKmh: kmh })
  const recIds = useStableRecommendations(candidates, recKey, habits.visited)
  const recs = useMemo(() => recIds.map((id) => viewsById.get(id)).filter((v): v is ViewPlace => !!v), [recIds, viewsById])
  const available = useMemo(() => categoriesIn(views), [views])

  // ---- screens / overlays
  const [screen, setScreen] = useState<Screen>('home')
  const [showAll, setShowAll] = useState(false)
  const [sheet, setSheetState] = useState<SheetKind>(null)
  const [gacha, setGachaState] = useState<ViewPlace[] | null>(null)
  const [detail, setDetailState] = useState<ViewPlace | null>(null)
  const [mode, setMode] = useState<RouteMode>('round')
  const [toast, setToast] = useState<ToastMsg | null>(null)
  const say = useCallback((text: string) => setToast({ id: Date.now() + Math.random(), text }), [])
  const clearToast = useCallback(() => setToast(null), [])

  // 戻るボタン（C22）: 詳細・シート・ガチャを開くときに履歴を 1 つ積み、popstate で閉じる
  const overlayPushed = useRef(false)
  useEffect(() => {
    const onPop = () => {
      overlayPushed.current = false
      setDetailState(null)
      setSheetState(null)
      setGachaState(null)
      setScreen(history.state?.screen === 'results' ? 'results' : 'home')
    }
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])
  const pushOverlay = () => {
    if (overlayPushed.current) return
    try {
      history.pushState({ ...(history.state ?? {}), overlay: true }, '')
      overlayPushed.current = true
    } catch {
      /* ignore */
    }
  }
  const popOverlay = () => {
    if (!overlayPushed.current) return
    overlayPushed.current = false
    try {
      history.back()
    } catch {
      /* ignore */
    }
  }
  const setSheet = (k: SheetKind) => {
    if (k) pushOverlay()
    setSheetState(k)
  }
  const closeSheet = () => {
    setSheetState(null)
    if (!detail && !gacha) popOverlay()
  }
  const openDetail = (p: ViewPlace) => {
    pushOverlay()
    setGachaState(null)
    setDetailState(p)
  }
  const closeDetail = () => {
    setDetailState(null)
    if (!sheet && !gacha) popOverlay()
  }
  const closeGacha = () => {
    setGachaState(null)
    if (!sheet && !detail) popOverlay()
  }

  const goResults = () => {
    if (!origin) {
      setSheet('origin')
      return
    }
    try {
      history.pushState({ screen: 'results' }, '')
    } catch {
      /* ignore */
    }
    setScreen('results')
    scrollTo?.({ top: 0 })
  }
  const goHome = () => {
    if (history.state?.screen === 'results') history.back()
    else setScreen('home')
  }

  // ---- 距離・時間はすべて tripEstimate で（D2）
  const effectiveMode: RouteMode = origin?.kind === 'demo' ? 'oneway' : mode
  const tripOf = useCallback((p: ViewPlace): TripEstimate => tripEstimate(p, effectiveMode, kmh), [effectiveMode, kmh])
  const goHrefOf = (p: ViewPlace) =>
    origin ? buildDepartUrl({ mode: effectiveMode, start: origin, destination: p }) : buildOneWayUrl({ destination: p })
  const asRide = (p: { id: string; name: string; category: RidePlace['category'] }): RidePlace => ({ id: p.id, name: p.name, category: p.category })
  const onGo = (p: ViewPlace, trip: TripEstimate = tripOf(p)) => habits.depart(asRide(p), trip.minutes)

  const openGacha = () => {
    if (!origin) {
      setSheet('origin')
      return
    }
    if (search.status === 'loading' || search.status === 'idle') {
      say('いま行き先をさがし中… ちょっと待ってね 🚲')
      return
    }
    const pool = screen === 'results' && showAll ? list : views
    if (pool.length === 0) {
      say('今の条件だと候補がないみたい。フィルタをゆるめてみよう')
      return
    }
    pushOverlay()
    setGachaState([...pool])
  }

  const celebrate = (text: string, added: boolean) => {
    say(text)
    if (added) {
      setBump((b) => b + 1)
      vibrate(12, reduced)
    }
  }

  const onRode = (p: ViewPlace, when: 'today' | 'yesterday') => {
    const r = habits.toggleRide(asRide(p), tripOf(p).minutes, when)
    if (r.kind === 'added' && when === 'today') setStampKey((k) => k + 1)
    celebrate(rideToast(r, p.name), r.kind === 'added')
  }

  const answerReturn = (rode: boolean) => {
    const name = habits.departure?.name ?? ''
    const r = habits.answerReturn(rode)
    if (r) celebrate(rideToast(r, name), true)
    else if (!rode) say('また今度いこう。いつでも待ってるよ')
  }

  // ---- SW 更新（C16）: ホーム表示中（何も開いていない）なら即時、それ以外はトーストで
  const applyUpdate = useSyncExternalStore(subscribeUpdate, getUpdateReady, () => null)
  const idleHome = screen === 'home' && !sheet && !detail && !gacha
  useEffect(() => {
    if (!applyUpdate) return
    if (idleHome) applyUpdate()
    else setToast({ id: Date.now(), text: '新しいバージョンがあります', action: { label: '更新する', onClick: applyUpdate } })
  }, [applyUpdate, idleHome])

  const daylight = useMemo(() => (origin ? daylightStatus(now, origin, minutes) : null), [origin, minutes, now])
  const returnCard =
    habits.departure && shouldAskReturn(habits.departure, now) ? (
      <ReturnCard departure={habits.departure} onYes={() => answerReturn(true)} onNo={() => answerReturn(false)} />
    ) : null

  // 詳細はいま表示中のデータ（写真・標高・経路距離の追加ロード後）を優先
  const detailView = detail ? (viewsById.get(detail.id) ?? detail) : null
  const isDemo = !!search.result?.isDemo || services.demo
  const demoReason = search.reason ? FALLBACK_MESSAGES[search.reason] : null
  const searchDone = search.status !== 'idle' && search.status !== 'loading'
  const homeCats = useMemo(() => topCategories(candidates), [candidates])

  return (
    <div className={`app app--${screen}`}>
      <a className="skip-link" href="#main">
        本文へ
      </a>
      {!online && <OfflineStrip stale={search.stale} />}
      <AppHeader
        streak={habits.streak}
        bump={bump}
        onRecords={() => setSheet('records')}
        onSettings={() => setSheet('settings')}
        onBack={screen === 'results' ? goHome : undefined}
        summary={
          <>
            <span className="num">{formatMinutesJa(minutes)}</span> · 片道<span className="num">{roadBudgetKm(minutes, kmh).toFixed(1)}km</span>
          </>
        }
        onGacha={screen === 'results' ? openGacha : undefined}
      />

      {screen === 'home' ? (
        <>
          <HomeView
            top={returnCard}
            origin={origin}
            locStatus={locStatus}
            locError={locError}
            onChangeOrigin={() => setSheet('origin')}
            onDemoOrigin={() => choose(DEMO_ORIGIN)}
            onRetryLocate={locate}
            index={index}
            onIndex={(i) => {
              updateSettings({ lastMinutes: ROUND_TRIP_MINUTES[i] })
              vibrate(8, reduced)
            }}
            oneWayKm={roadBudgetKm(minutes, kmh)}
            speed={settings.speedPreset}
            onSpeedTap={() => setSheet('settings')}
            daylight={daylight}
            firstRun={firstRun}
            demo={isDemo && origin && searchDone ? <DemoPill reason={demoReason} /> : null}
            categories={homeCats}
            count={origin && searchDone ? views.length : null}
            isDemo={isDemo}
          />
          <div className="bottom-bar">
            <div className="bottom-bar__row">
              <button type="button" className="btn btn--secondary bottom-bar__gacha pressable" onClick={openGacha}>
                <span aria-hidden="true">🎲</span> おまかせ
              </button>
              {origin ? (
                <button type="button" className="btn btn--primary bottom-bar__go pressable" onClick={goResults}>
                  候補を見る <span className="arrow">→</span>
                </button>
              ) : (
                <button type="button" className="btn btn--primary bottom-bar__go pressable" onClick={() => setSheet('origin')}>
                  出発地をえらぶ <span className="arrow">→</span>
                </button>
              )}
            </div>
          </div>
        </>
      ) : (
        <ResultsView
          top={returnCard}
          status={search.status}
          total={views.length}
          recs={recs}
          list={list}
          showAll={showAll}
          onShowAll={() => setShowAll(true)}
          filter={filter}
          onFilter={setFilter}
          available={available}
          isDemo={isDemo}
          demoReason={demoReason}
          fallback={search.fallback}
          tripOf={tripOf}
          goHrefOf={goHrefOf}
          goLabel="Googleマップで出発"
          onGo={(p) => onGo(p)}
          onOpen={openDetail}
          onToggleFavorite={(p) => habits.toggleFav(p)}
          observe={observe}
          onRetry={search.retry}
          onAddTime={() => updateSettings({ lastMinutes: ROUND_TRIP_MINUTES[Math.min(index + 1, ROUND_TRIP_MINUTES.length - 1)] })}
          canAddTime={index < ROUND_TRIP_MINUTES.length - 1}
          onChangeOrigin={() => setSheet('origin')}
          onGacha={openGacha}
        />
      )}

      {detailView && origin && (
        <DetailSheet
          place={detailView}
          origin={origin}
          services={services}
          speedKmh={kmh}
          minutes={minutes}
          mode={effectiveMode}
          onMode={setMode}
          rodeToday={habits.rides.some((r) => r.placeId === detailView.id && r.date === habits.todayKey)}
          rodeYesterday={habits.rides.some((r) => r.placeId === detailView.id && r.date === habits.yesterdayKey)}
          stampKey={stampKey}
          onRode={onRode}
          onGo={(p, _mode, trip) => onGo(p, trip)}
          onToggleFavorite={(p) => habits.toggleFav(p)}
          onRouteResult={setRouteResult}
          onClose={closeDetail}
        />
      )}

      {gacha && (
        <GachaOverlay
          pool={gacha}
          tripOf={tripOf}
          goHrefOf={goHrefOf}
          canDepart={!search.fallback}
          reduced={reduced}
          onGo={(p) => {
            onGo(p)
            closeGacha()
          }}
          onDecide={openDetail}
          onClose={closeGacha}
        />
      )}

      <RecordsSheet
        open={sheet === 'records'}
        onClose={closeSheet}
        rides={habits.rides}
        stamps={habits.stamps}
        streak={habits.streak}
        best={habits.best}
        weekCount={habits.weekCount}
        weeklyGoal={settings.weeklyGoal}
        today={habits.today}
        onDeleteRide={habits.deleteRide}
      />
      <SettingsSheet
        open={sheet === 'settings'}
        onClose={closeSheet}
        speed={settings.speedPreset}
        onSpeed={(speedPreset) => updateSettings({ speedPreset })}
        weeklyGoal={settings.weeklyGoal}
        onWeeklyGoal={(weeklyGoal) => updateSettings({ weeklyGoal })}
        origin={origin}
        onChangeOrigin={() => setSheet('origin')}
      />
      <OriginSheet
        open={sheet === 'origin'}
        onClose={closeSheet}
        services={services}
        canLocate={typeof navigator !== 'undefined' && !!navigator.geolocation}
        onLocate={locate}
        onChoose={choose}
      />
      <Toast toast={toast} onDone={clearToast} />
    </div>
  )
}
