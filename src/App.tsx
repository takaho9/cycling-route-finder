// 仮の最小 UI。docs/DESIGN.md 確定後に作り直す前提。
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchElevationSummaries } from './lib/elevation'
import { buildOneWayUrl, buildRoundTripUrl, googlePlaceIdFromId } from './lib/gmaps'
import { searchPlaces, type SearchResult } from './lib/places'
import { computeReach, estimateRoundTripMin, formatMinutesJa, ROUND_TRIP_MINUTES, SPEED_PRESETS, type SpeedPresetId } from './lib/reach'
import { loadSettings, saveSettings } from './lib/storage'
import type { ElevationSummary, LatLng } from './lib/types'

export const DEMO_LOCATION: LatLng = { lat: 35.681236, lng: 139.767125 } // 東京駅

const LABEL_JA: Record<ElevationSummary['label'], string> = { flat: 'フラット', rolling: 'ゆるアップダウン', hilly: 'ヒルクライム' }

export default function App() {
  const [origin, setOrigin] = useState<LatLng>(DEMO_LOCATION)
  const [locStatus, setLocStatus] = useState<'locating' | 'gps' | 'demo'>('locating')
  const [minutes, setMinutes] = useState<number | null>(null)
  const [speed, setSpeed] = useState<SpeedPresetId>(() => loadSettings().speedPreset)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [elev, setElev] = useState<Map<string, ElevationSummary | null>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocStatus('demo')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLocStatus('gps')
      },
      () => setLocStatus('demo'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    )
  }, [])

  useEffect(() => {
    saveSettings({ speedPreset: speed })
  }, [speed])

  const kmh = SPEED_PRESETS[speed].kmh
  const reach = useMemo(() => (minutes ? computeReach(minutes, kmh) : null), [minutes, kmh])

  useEffect(() => {
    if (!reach || locStatus === 'locating') return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)
    setError(null)
    setResult(null)
    setElev(new Map())
    searchPlaces(origin, reach.minKm, reach.bandMaxKm, { signal: ac.signal })
      .then(async (r) => {
        setResult(r)
        setLoading(false)
        const need = r.places.filter((p) => !p.elevation)
        if (need.length) setElev(await fetchElevationSummaries(origin, need, { signal: ac.signal }))
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return
        setError(String(e))
        setLoading(false)
      })
    return () => ac.abort()
  }, [origin, reach, locStatus])

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20 }}>ちょいチャリ（仮UI）</h1>
      <p style={{ fontSize: 12, color: '#666' }}>
        現在地: {locStatus === 'gps' ? 'GPS' : locStatus === 'demo' ? 'デモ地点（東京駅）' : '取得中…'}
      </p>
      <div role="group" aria-label="速度" style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {Object.values(SPEED_PRESETS).map((p) => (
          <button key={p.id} aria-pressed={speed === p.id} onClick={() => setSpeed(p.id)}>
            {p.label} {p.kmh}km/h
          </button>
        ))}
      </div>
      <div role="group" aria-label="往復時間" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {ROUND_TRIP_MINUTES.map((m) => (
          <button key={m} aria-pressed={minutes === m} onClick={() => setMinutes(m)} style={{ minHeight: 44 }}>
            {formatMinutesJa(m)}
          </button>
        ))}
      </div>
      {reach && (
        <p style={{ fontSize: 12 }}>
          片道 {reach.minKm.toFixed(1)}〜{reach.bandMaxKm.toFixed(1)} km（直線）
        </p>
      )}
      {loading && <p>探しています…</p>}
      {error && <p role="alert">取得に失敗しました: {error}</p>}
      {result && (
        <>
          <p style={{ fontSize: 12 }}>
            {result.places.length}件 / source: {result.source}
            {result.isDemo && '（デモデータ）'}
          </p>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {result.places.map((p) => {
              const e = p.elevation ?? elev.get(p.id) ?? null
              const placeId = googlePlaceIdFromId(p.id)
              return (
                <li key={p.id} style={{ borderBottom: '1px solid #ddd', padding: '8px 0' }}>
                  <strong>{p.name}</strong> <small>[{p.category}]</small>
                  <div style={{ fontSize: 12 }}>
                    片道 {p.distanceKm.toFixed(1)}km ・ 往復約 {formatMinutesJa(estimateRoundTripMin(p.distanceKm, kmh))}
                    {e && ` ・ 獲得標高 ${Math.round(e.gainRoundTripM)}m（${LABEL_JA[e.label]}）最大勾配 ${e.maxGradePct}%`}
                  </div>
                  <a href={buildOneWayUrl({ origin, destination: p, destinationPlaceId: placeId })} target="_blank" rel="noreferrer">
                    片道ナビ
                  </a>{' '}
                  <a href={buildRoundTripUrl({ origin, destination: p, destinationPlaceId: placeId })} target="_blank" rel="noreferrer">
                    往復ナビ
                  </a>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </main>
  )
}
