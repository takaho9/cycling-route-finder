import { useCallback, useEffect, useRef, useState } from 'react'
import type { PhotoInfo } from '../lib/photos'
import { PHOTO_WIDTH_LIST } from '../lib/photos'
import type { Services } from '../lib/services'
import type { ElevationSummary, LatLng, Place } from '../lib/types'

/** 1 回の標高リクエストで扱う候補数（10 候補 × 10 点 = 100 点 = Open-Meteo 1 リクエスト） */
const ELEVATION_CHUNK = 10
/** 写真解決 1 回あたりの候補数 */
const PHOTO_CHUNK = 12
/** 候補が変わってから取りに行くまでの待ち（時間ダイヤルを連続で回したときに無駄撃ちしない, BACKLOG-2 C21） */
export const ENRICH_DEBOUNCE_MS = 300

/**
 * 段階ロード: 候補リストはすぐ表示し、写真と標高は「表示中のカード」から順に非同期で埋める。
 * - 標高: 見えている候補を優先して 10 件ずつ Open-Meteo にバッチ（1 リクエスト = 100 点）
 * - 写真: 見えている候補を優先して 12 件ずつ（Wikidata/Commons は内部で 50 件バッチ、近傍検索は並列 4）
 */
export function useEnrichment(services: Services, origin: LatLng | null, places: readonly Place[]) {
  const [elevations, setElevations] = useState<ReadonlyMap<string, ElevationSummary | null>>(new Map())
  const [photos, setPhotos] = useState<ReadonlyMap<string, PhotoInfo | null>>(new Map())
  /** 詳細で取れた経路距離（片道 km, OSRM のときだけ）。一覧の距離・時間にも使う（D2） */
  const [routeKm, setRouteKm] = useState<ReadonlyMap<string, number>>(new Map())
  const visible = useRef(new Set<string>())
  const order = useRef<Place[]>([])
  const doneElev = useRef(new Set<string>())
  const donePhoto = useRef(new Set<string>())
  const busy = useRef({ elev: false, photo: false })
  const acRef = useRef<AbortController | null>(null)
  const pumpRef = useRef<() => void>(() => {})
  const originKey = origin ? `${origin.lat},${origin.lng}` : ''

  // 出発地が変わったら全部やり直し
  useEffect(() => {
    acRef.current?.abort()
    acRef.current = new AbortController()
    doneElev.current = new Set()
    donePhoto.current = new Set()
    busy.current = { elev: false, photo: false }
    setElevations(new Map())
    setPhotos(new Map())
    setRouteKm(new Map())
    return () => acRef.current?.abort()
  }, [originKey])

  const pick = (done: Set<string>, n: number, need: (p: Place) => boolean) => {
    const pending = order.current.filter((p) => !done.has(p.id) && need(p))
    const vis = pending.filter((p) => visible.current.has(p.id))
    const rest = pending.filter((p) => !visible.current.has(p.id))
    return [...vis, ...rest].slice(0, n)
  }

  const pump = useCallback(() => {
    const ac = acRef.current
    if (!origin || !ac || ac.signal.aborted) return
    if (!busy.current.elev) {
      const batch = pick(doneElev.current, ELEVATION_CHUNK, (p) => !p.elevation)
      if (batch.length) {
        busy.current.elev = true
        batch.forEach((p) => doneElev.current.add(p.id))
        services
          .elevations(origin, batch, ac.signal)
          .then((m) => {
            if (ac.signal.aborted) return
            setElevations((prev) => {
              const next = new Map(prev)
              batch.forEach((p) => next.set(p.id, m.get(p.id) ?? null))
              return next
            })
          })
          .catch(() => {})
          .finally(() => {
            if (ac.signal.aborted) return
            busy.current.elev = false
            pumpRef.current()
          })
      }
    }
    if (!busy.current.photo) {
      const batch = pick(donePhoto.current, PHOTO_CHUNK, () => true)
      if (batch.length) {
        busy.current.photo = true
        batch.forEach((p) => donePhoto.current.add(p.id))
        services
          .photos(batch, PHOTO_WIDTH_LIST, ac.signal)
          .then((m) => {
            if (ac.signal.aborted) return
            setPhotos((prev) => {
              const next = new Map(prev)
              batch.forEach((p) => next.set(p.id, m.get(p.id) ?? null))
              return next
            })
          })
          .catch(() => {})
          .finally(() => {
            if (ac.signal.aborted) return
            busy.current.photo = false
            pumpRef.current()
          })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, originKey])
  pumpRef.current = pump

  useEffect(() => {
    order.current = [...places]
    const t = setTimeout(() => pumpRef.current(), ENRICH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [places, pump])

  const markVisible = useCallback((id: string, isVisible: boolean) => {
    if (isVisible) visible.current.add(id)
    else visible.current.delete(id)
    if (isVisible) pumpRef.current()
  }, [])

  /**
   * 詳細で経路（OSRM）が取れたら、経路距離と経路沿いの標高でカードも更新（A8, BACKLOG-2 C3/D2）。
   * 直線フォールバックの結果はここに渡さないこと（一覧の推定値を上書きしない）。
   */
  const setRouteResult = useCallback((id: string, r: { km: number; elevation: ElevationSummary | null }) => {
    setRouteKm((prev) => new Map(prev).set(id, r.km))
    const s = r.elevation
    if (s && !s.estimated) setElevations((prev) => new Map(prev).set(id, s))
  }, [])

  return { elevations, photos, routeKm, markVisible, setRouteResult }
}

export type ObserveRef = (el: HTMLElement | null) => void | (() => void)

/**
 * IntersectionObserver で要素の表示状態を通知（未対応環境では何もしない）。
 * 返すのは ref コールバック。要素が外れたら unobserve して「非表示」を通知する（BACKLOG-2 C18: unobserve 漏れ）。
 */
export function useVisibility(onChange: (id: string, visible: boolean) => void): ObserveRef {
  const obs = useRef<IntersectionObserver | null>(null)
  const cb = useRef(onChange)
  cb.current = onChange
  useEffect(() => () => obs.current?.disconnect(), [])
  return useCallback((el: HTMLElement | null) => {
    if (!el || typeof IntersectionObserver === 'undefined') return
    obs.current ??= new IntersectionObserver(
      (entries) => entries.forEach((e) => cb.current((e.target as HTMLElement).dataset.placeId ?? '', e.isIntersecting)),
      { rootMargin: '200px 0px' },
    )
    const o = obs.current
    o.observe(el)
    return () => {
      o.unobserve(el)
      const id = el.dataset.placeId
      if (id) cb.current(id, false)
    }
  }, [])
}
