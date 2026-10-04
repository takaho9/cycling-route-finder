import { useCallback, useEffect, useRef, useState } from 'react'
import { fallbackReason, type FallbackReason, type SearchResult } from '../lib/places'
import type { Services } from '../lib/services'
import { loadLastResult, saveLastResult } from '../lib/storage'
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
 * 出発地が決まったら 1 回だけ検索する（時間・速度の切替では再検索しない, R6）。
 */
export function usePlaceSearch(services: Services, origin: LatLng | null, online: boolean) {
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
      const last = loadLastResult()
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
      .search(center, ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return
        setState({ status: r.kind, result: r, reason: r.isDemo ? fallbackReason(r.errors) : null, stale: false })
        if (!r.isDemo && !services.demo) {
          saveLastResult({ origin: center, places: r.places, source: r.source, savedAt: new Date().toISOString() })
        }
      })
      .catch(() => {
        if (ac.signal.aborted) return
        setState({ status: 'error', result: null, reason: 'unknown', stale: false })
      })
    return () => ac.abort()
  }, [services, lat, lng, online, nonce])

  const retry = useCallback(() => setNonce((n) => n + 1), [])
  return { ...state, retry }
}
