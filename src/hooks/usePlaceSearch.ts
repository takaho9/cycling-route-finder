import { useCallback, useEffect, useRef, useState } from 'react'
import { placesForOffline } from '../lib/candidates'
import { fallbackReason, type FallbackReason, type SearchResult } from '../lib/places'
import type { Services } from '../lib/services'
import { loadLastResultNear, saveLastResult } from '../lib/storage'
import type { LatLng } from '../lib/types'

export type SearchStatus = 'idle' | 'loading' | 'ok' | 'empty' | 'demo' | 'error'

export interface PlaceSearchState {
  status: SearchStatus
  result: SearchResult | null
  /** 実データが取れなかった理由（demo 時） */
  reason: FallbackReason | null
  /** オフラインで前回の結果を表示中 */
  stale: boolean
}

/**
 * 出発地・速度が決まったら 1 回だけ検索する（時間の切替では再検索しない, R6。速度を変えたら再取得, C1）。
 * - オフライン時は、出発地が 1km 以内で保存した前回結果だけを使う（C5）
 * - 実 API が失敗してデモに落ちたとき（?demo=1 以外）は、画面が見えるようになったら自動で再試行（C6）
 */
export function usePlaceSearch(services: Services, origin: LatLng | null, online: boolean, speedKmh: number) {
  const [state, setState] = useState<PlaceSearchState>({ status: 'idle', result: null, reason: null, stale: false })
  const [nonce, setNonce] = useState(0)
  const acRef = useRef<AbortController | null>(null)
  const lat = origin?.lat
  const lng = origin?.lng

  useEffect(() => {
    if (lat === undefined || lng === undefined) return
    const center = { lat, lng }
    acRef.current?.abort()
    const ac = new AbortController()
    acRef.current = ac
    if (!online && !services.demo) {
      const last = loadLastResultNear(center)
      if (last) {
        setState({
          status: last.places.length ? 'ok' : 'empty',
          result: { kind: last.places.length ? 'ok' : 'empty', places: last.places, source: last.source, isDemo: false, errors: [] },
          reason: null,
          stale: true,
        })
        return () => ac.abort()
      }
    }
    setState((s) => ({ ...s, status: 'loading', stale: false }))
    services
      .search(center, speedKmh, ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return
        setState({ status: r.kind, result: r, reason: r.isDemo ? fallbackReason(r.errors) : null, stale: false })
        if (!r.isDemo && !services.demo) {
          saveLastResult({ origin: center, places: placesForOffline(r.places, speedKmh), source: r.source, savedAt: new Date().toISOString() })
        }
      })
      .catch(() => {
        if (ac.signal.aborted) return
        setState({ status: 'error', result: null, reason: 'unknown', stale: false })
      })
    return () => ac.abort()
  }, [services, lat, lng, online, speedKmh, nonce])

  const retry = useCallback(() => setNonce((n) => n + 1), [])

  /** 実データ取得に失敗してデモ表示中（?demo=1 ではない）なら true（C6） */
  const fallback = state.status === 'demo' && !services.demo

  // C6: デモに落ちている間は、アプリに戻ってきた（visible になった）ときに自動で再試行
  useEffect(() => {
    if (!fallback || typeof document === 'undefined') return
    const onVisible = () => {
      if (document.visibilityState === 'visible') retry()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [fallback, retry])

  return { ...state, fallback, retry }
}
