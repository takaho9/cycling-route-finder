import { useCallback, useEffect, useRef, useState } from 'react'
import type { Origin } from '../components/types'
import { PRESET_ORIGINS } from '../lib/geocode'
import type { Services } from '../lib/services'
import { pushRecentOrigin } from '../lib/storage'

/** デモ地点（東京駅）。位置が仮のとき往復ルートは使わない（A6） */
export const DEMO_ORIGIN: Origin = { ...PRESET_ORIGINS[0], kind: 'demo' }
/** この精度 (m) を超えたら注意を出す（Y6） */
export const POOR_ACCURACY_M = 500

export type LocateStatus = 'locating' | 'ready' | 'denied'

/**
 * 出発地の管理（Y6）。
 * - 位置情報が取れたら GPS。拒否/不可なら自動で東京駅を検索せず、出発地の選択を先に出す（origin = null）。
 * - 「デモで試す（東京駅）」は kind=demo、手動指定は kind=manual。
 */
export function useOrigin(services: Services) {
  const [origin, setOrigin] = useState<Origin | null>(null)
  const [status, setStatus] = useState<LocateStatus>('locating')
  const ac = useRef<AbortController | null>(null)

  const locate = useCallback(() => {
    const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation
    if (!geo) {
      setStatus('denied')
      return
    }
    setStatus('locating')
    geo.getCurrentPosition(
      (pos) => {
        const o: Origin = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: '現在地',
          kind: 'gps',
          accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined,
        }
        setOrigin(o)
        setStatus('ready')
        ac.current?.abort()
        const c = (ac.current = new AbortController())
        services
          .placeName(o, c.signal)
          .then((name) => {
            if (!name || c.signal.aborted) return
            setOrigin((cur) => (cur && cur.kind === 'gps' && cur.lat === o.lat && cur.lng === o.lng ? { ...cur, label: `${name} 付近` } : cur))
          })
          .catch(() => {})
      },
      () => setStatus((s) => (s === 'ready' ? s : 'denied')),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 120_000 },
    )
  }, [services])

  useEffect(() => {
    locate()
    return () => ac.current?.abort()
  }, [locate])

  const choose = useCallback((o: Origin) => {
    ac.current?.abort()
    setOrigin(o)
    setStatus('ready')
    if (o.kind === 'manual') pushRecentOrigin({ lat: o.lat, lng: o.lng, label: o.label })
  }, [])

  return { origin, status, locate, choose }
}
