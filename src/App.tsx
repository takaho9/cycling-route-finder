import { useCallback, useEffect, useMemo, useState } from 'react'
import { DemoPill, OfflineStrip } from './components/Banners'
import { DetailSheet } from './components/DetailSheet'
import { GachaOverlay } from './components/GachaOverlay'
import { AppHeader } from './components/Header'
import { HomeView } from './components/HomeView'
import { OriginSheet } from './components/OriginSheet'
import type { CardMetrics } from './components/PlaceCard'
import { RecordsSheet } from './components/RecordsSheet'
import { ResultsView, type FilterState } from './components/ResultsView'
import { ReturnCard } from './components/ReturnCard'
import { SettingsSheet } from './components/SettingsSheet'
import { Toast, type ToastMsg } from './components/Toast'
import type { RouteMode, ViewPlace } from './components/types'
import { useEnrichment, useVisibility } from './hooks/useEnrichment'
import { rideToast, useHabits, type RidePlace } from './hooks/useHabits'
import { useOnline, useReducedMotion, vibrate } from './hooks/useMedia'
import { DEMO_ORIGIN, useOrigin } from './hooks/useOrigin'
import { usePlaceSearch } from './hooks/usePlaceSearch'
import { categoriesIn, filterAndSort, pickRecommendations, selectCandidates } from './lib/candidates'
import { buildOneWayUrl, buildRoundTripUrl } from './lib/gmaps'
import { FALLBACK_MESSAGES } from './lib/places'
import { estimateRoundTripMin, formatMinutesJa, roadBudgetKm, roadKmEstimate, ROUND_TRIP_MINUTES, SPEED_PRESETS } from './lib/reach'
import { demoServices, isDemoMode, realServices, type Services } from './lib/services'
import { loadFlag, loadSettings, saveSettings, setFlag, shouldAskReturn, type Settings } from './lib/storage'
import { daylightStatus } from './lib/sun'
import type { ElevationSummary } from './lib/types'

type Screen = 'home' | 'results'
type SheetKind = 'records' | 'settings' | 'origin' | null

const DEFAULT_FILTER: FilterState = { elevation: 'all', categories: new Set(), sort: 'near' }

function indexOfMinutes(min: number): number {
  const i = ROUND_TRIP_MINUTES.indexOf(min as (typeof ROUND_TRIP_MINUTES)[number])
  return i >= 0 ? i : 2
}

const systemNow = () => new Date()

export default function App({ services: injected, now = systemNow }: { services?: Services; now?: () => Date } = {}) {
  const services = useMemo(() => injected ?? (isDemoMode() ? demoServices : realServices), [injected])
  const reduced = useReducedMotion()
  const online = useOnline()

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
  const { origin, status: locStatus, locate, choose } = useOrigin(services)
  const search = usePlaceSearch(services, origin, online)
  const all = search.result?.places
  const candidates = useMemo(() => (all ? selectCandidates(all, minutes, kmh) : []), [all, minutes, kmh])
  const { elevations, photos, markVisible, setElevation } = useEnrichment(services, origin, candidates)
  const observe = useVisibility(markVisible)

  // ---- habits
  const habits = useHabits(settings.weeklyGoal, now)
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
          visited: habits.visited.has(p.id),
          favorite: habits.favoriteIds.has(p.id),
        }
      }),
    [candidates, elevations, photos, habits.visited, habits.favoriteIds],
  )

  // ---- filter / list
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER)
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31))
  const list = useMemo(
    () => filterAndSort(views, { ...filter, visited: habits.visited, seed }),
    [views, filter, habits.visited, seed],
  )
  const recs = useMemo(
    () => pickRecommendations(views, { dateKey: habits.todayKey, visited: habits.visited }),
    [views, habits.todayKey, habits.visited],
  )
  const available = useMemo(() => categoriesIn(views), [views])

  // ---- screens / overlays
  const [screen, setScreen] = useState<Screen>('home')
  const [showAll, setShowAll] = useState(false)
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [gacha, setGacha] = useState<ViewPlace[] | null>(null)
  const [detail, setDetail] = useState<ViewPlace | null>(null)
  const [mode, setMode] = useState<RouteMode>('round')
  const [toast, setToast] = useState<ToastMsg | null>(null)
  const say = useCallback((text: string) => setToast({ id: Date.now() + Math.random(), text }), [])
  const clearToast = useCallback(() => setToast(null), [])

  // ブラウザの「戻る」で一覧 → ホーム
  useEffect(() => {
    const onPop = () => setScreen('home')
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])
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

  const roundAllowed = origin?.kind !== 'demo'
  const effectiveMode: RouteMode = roundAllowed ? mode : 'oneway'
  const metricsOf = useCallback(
    (p: ViewPlace): CardMetrics => ({
      km: roadKmEstimate(p.distanceKm),
      min: estimateRoundTripMin(p.distanceKm, kmh, { gainRoundTripM: p.elevation?.gainRoundTripM ?? 0 }),
    }),
    [kmh],
  )
  const goHrefOf = (p: ViewPlace) =>
    effectiveMode === 'round' && origin ? buildRoundTripUrl({ start: origin, destination: p }) : buildOneWayUrl({ destination: p })
  const asRide = (p: { id: string; name: string; category: RidePlace['category'] }): RidePlace => ({ id: p.id, name: p.name, category: p.category })
  const onGo = (p: ViewPlace) => habits.depart(asRide(p), metricsOf(p).min)

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
    setGacha([...pool])
  }

  const celebrate = (text: string, added: boolean) => {
    say(text)
    if (added) {
      setBump((b) => b + 1)
      vibrate(12, reduced)
    }
  }

  const onRode = (p: ViewPlace, when: 'today' | 'yesterday') => {
    const r = habits.toggleRide(asRide(p), Math.round(metricsOf(p).min), when)
    if (r.kind === 'added' && when === 'today') setStampKey((k) => k + 1)
    celebrate(rideToast(r, p.name), r.kind === 'added')
  }

  const answerReturn = (rode: boolean) => {
    const name = habits.departure?.name ?? ''
    const r = habits.answerReturn(rode)
    if (r) celebrate(rideToast(r, name), true)
    else if (!rode) say('また今度いこう。いつでも待ってるよ')
  }

  const daylight = useMemo(() => (origin ? daylightStatus(now(), origin, minutes) : null), [origin, minutes, now])
  const returnCard =
    habits.departure && shouldAskReturn(habits.departure, now()) ? (
      <ReturnCard departure={habits.departure} onYes={() => answerReturn(true)} onNo={() => answerReturn(false)} />
    ) : null

  // 詳細はいま表示中のデータ（写真・標高の追加ロード後）を優先
  const detailView = detail ? (views.find((v) => v.id === detail.id) ?? detail) : null
  const isDemo = !!search.result?.isDemo || services.demo
  const demoReason = search.reason ? FALLBACK_MESSAGES[search.reason] : null

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
            onChangeOrigin={() => setSheet('origin')}
            onDemoOrigin={() => choose(DEMO_ORIGIN)}
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
            demo={isDemo && origin && search.status !== 'loading' ? <DemoPill reason={demoReason} /> : null}
          />
          <div className="bottom-bar">
            <div className="bottom-bar__row">
              <button type="button" className="btn btn--secondary bottom-bar__gacha pressable" onClick={openGacha}>
                <span aria-hidden="true">🎲</span> おまかせ
              </button>
              <button type="button" className="btn btn--primary bottom-bar__go pressable" onClick={goResults}>
                候補を見る <span className="arrow">→</span>
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
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
            metricsOf={metricsOf}
            goHrefOf={goHrefOf}
            goLabel="Googleマップで出発"
            onGo={onGo}
            onOpen={(p) => setDetail(p)}
            onToggleFavorite={(p) => habits.toggleFav(p)}
            observe={observe}
            onRetry={search.retry}
            onAddTime={() => updateSettings({ lastMinutes: ROUND_TRIP_MINUTES[Math.min(index + 1, ROUND_TRIP_MINUTES.length - 1)] })}
            canAddTime={index < ROUND_TRIP_MINUTES.length - 1}
            onChangeOrigin={() => setSheet('origin')}
          />
          <button type="button" className="fab pressable" onClick={openGacha} aria-label="おまかせ（ガチャ）">
            <span aria-hidden="true">🎲</span>
          </button>
        </>
      )}

      {detailView && origin && (
        <DetailSheet
          place={detailView}
          origin={origin}
          roundTripAllowed={roundAllowed}
          services={services}
          speedKmh={kmh}
          minutes={minutes}
          mode={effectiveMode}
          onMode={setMode}
          rodeToday={habits.rides.some((r) => r.placeId === detailView.id && r.date === habits.todayKey)}
          rodeYesterday={habits.rides.some((r) => r.placeId === detailView.id && r.date === habits.yesterdayKey)}
          stampKey={stampKey}
          onRode={onRode}
          onGo={(p) => onGo(p)}
          onToggleFavorite={(p) => habits.toggleFav(p)}
          onRouteElevation={setElevation}
          onClose={() => setDetail(null)}
        />
      )}

      {gacha && (
        <GachaOverlay
          pool={gacha}
          metricsOf={metricsOf}
          reduced={reduced}
          onDecide={(p) => {
            setGacha(null)
            setDetail(p)
          }}
          onClose={() => setGacha(null)}
        />
      )}

      <RecordsSheet
        open={sheet === 'records'}
        onClose={() => setSheet(null)}
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
        onClose={() => setSheet(null)}
        speed={settings.speedPreset}
        onSpeed={(speedPreset) => updateSettings({ speedPreset })}
        weeklyGoal={settings.weeklyGoal}
        onWeeklyGoal={(weeklyGoal) => updateSettings({ weeklyGoal })}
        origin={origin}
        onChangeOrigin={() => setSheet('origin')}
      />
      <OriginSheet
        open={sheet === 'origin'}
        onClose={() => setSheet(null)}
        services={services}
        canLocate={typeof navigator !== 'undefined' && !!navigator.geolocation}
        onLocate={locate}
        onChoose={choose}
      />
      <Toast toast={toast} onDone={clearToast} />
    </div>
  )
}
