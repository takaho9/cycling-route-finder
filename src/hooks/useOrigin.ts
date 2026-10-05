import { useCallback, useEffect, useRef, useState } from 'react'
import type { Origin } from '../components/types'
import { PRESET_ORIGINS } from '../lib/geocode'
import type { Services } from '../lib/services'
import { pushRecentOrigin } from '../lib/storage'

/** デモ地点（東京駅）。位置が仮のとき往復ルートは使わない（A6） */
export const DEMO_ORIGIN: Origin = { ...PRESET_ORIGINS[0], kind: 'demo' }
/** この精度 (m) を超えたら注意を出し、高精度で取り直す（Y6, BACKLOG-2 C9） */
export const POOR_ACCURACY_M = 500

export type LocateStatus = 'locating' | 'ready' | 'denied'
/** 位置が取れなかった理由（GeolocationPositionError.code: 1=拒否 / 2=取得不可 / 3=タイムアウト） */
export type LocateError = 'denied' | 'unavailable' | 'timeout' | 'unsupported'

export const LOCATE_MESSAGES: Record<LocateError, { title: string; body: string }> = {
  denied: { title: '位置情報がオフみたい。出発地をえらぼう', body: '駅名や住所でさがせるよ。まず試すだけなら東京駅からでも OK。' },
  timeout: { title: '現在地がなかなか取れないみたい', body: 'もう一度ためすか、駅名や住所で出発地をえらんでね。' },
  unavailable: { title: 'いまは現在地が取れないみたい', body: '電波のいい場所でもう一度ためすか、駅名や住所で出発地をえらんでね。' },
  unsupported: { title: 'この端末では現在地が使えないみたい', body: '駅名や住所で出発地をえらぼう。まず試すだけなら東京駅からでも OK。' },
}

export function locateErrorOf(code: number | undefined): LocateError {
  if (code === 1) return 'denied'
  if (code === 3) return 'timeout'
  return 'unavailable'
}

/**
 * 出発地の管理（Y6, BACKLOG-2 C9）。
 * - 位置情報が取れたら GPS。拒否/不可なら自動で東京駅を検索せず、出発地の選択を先に出す（origin = null）。
 * - 「デモで試す（東京駅）」は kind=demo、手動指定は kind=manual。
 * - 世代番号で古い GPS 結果を捨てる（手動で選んだ後に遅れて届いた GPS で上書きしない）。
 * - 精度が 500m を超えたら高精度（enableHighAccuracy）で取り直す。
 */
export function useOrigin(services: Services) {
  const [origin, setOrigin] = useState<Origin | null>(null)
  const [status, setStatus] = useState<LocateStatus>('locating')
  const [error, setError] = useState<LocateError | null>(null)
  const ac = useRef<AbortController | null>(null)
  const gen = useRef(0)

  const nameIt = useCallback(
    (o: Origin) => {
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
    [services],
  )

  const locate = useCallback(() => {
    const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation
    const my = ++gen.current
    if (!geo) {
      setStatus('denied')
      setError('unsupported')
      return
    }
    setStatus((s) => (s === 'ready' ? s : 'locating'))
    const toOrigin = (pos: GeolocationPosition): Origin => ({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      label: '現在地',
      kind: 'gps',
      accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined,
    })
    const accept = (o: Origin) => {
      setOrigin(o)
      setStatus('ready')
      setError(null)
      nameIt(o)
    }
    geo.getCurrentPosition(
      (pos) => {
        if (my !== gen.current) return // 古い結果（その後に locate / choose された）
        const o = toOrigin(pos)
        accept(o)
        if ((o.accuracyM ?? 0) > POOR_ACCURACY_M) {
          // おおまかな位置（Wi-Fi/基地局）だったので高精度で取り直す。失敗したら今の位置のまま
          geo.getCurrentPosition(
            (better) => {
              if (my !== gen.current) return
              const b = toOrigin(better)
              if ((b.accuracyM ?? Infinity) < (o.accuracyM ?? Infinity)) accept(b)
            },
            () => {},
            { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
          )
        }
      },
      (err) => {
        if (my !== gen.current) return
        setStatus((s) => (s === 'ready' ? s : 'denied'))
        setError(locateErrorOf(err?.code))
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 120_000 },
    )
  }, [nameIt])

  useEffect(() => {
    locate()
    return () => ac.current?.abort()
  }, [locate])

  const choose = useCallback((o: Origin) => {
    gen.current++ // 進行中の GPS 結果は捨てる
    ac.current?.abort()
    setOrigin(o)
    setStatus('ready')
    setError(null)
    if (o.kind === 'manual') pushRecentOrigin({ lat: o.lat, lng: o.lng, label: o.label })
  }, [])

  return { origin, status, error, locate, choose }
}
