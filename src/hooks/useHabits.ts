import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Category } from '../lib/types'
import {
  addRide,
  clearDeparture,
  computeBestStreak,
  computeStreak,
  countThisWeek,
  hasRideOn,
  isDepartureExpired,
  loadDeparture,
  loadFavorites,
  loadRides,
  previousDateKey,
  removeRide,
  rideDateKey,
  rideToday,
  saveDeparture,
  stampsFromRides,
  toggleFavorite,
  visitedPlaceIds,
  type Departure,
  type FavoritePlace,
  type RideRecord,
} from '../lib/storage'

export interface RidePlace {
  id: string
  name: string
  category: Category
}

export type RideOutcome =
  | { kind: 'removed' }
  | { kind: 'added'; streak: number; weekCount: number; newStamp: boolean; goalReached: boolean }

/** 走行記録・ストリーク・スタンプ・お気に入り・出発記録（DESIGN §3.5, BACKLOG R7/A7） */
const systemNow = () => new Date()

/**
 * clock: 操作した瞬間の時刻（記録・出発）。nowDate: 表示用の「いま」（useNow で再評価される, BACKLOG-2 C4）。
 */
export function useHabits(weeklyGoal: number, now: () => Date = systemNow, nowDate: Date = now()) {
  const [rides, setRides] = useState<RideRecord[]>(() => loadRides())
  const [favorites, setFavorites] = useState<FavoritePlace[]>(() => loadFavorites())
  const [departure, setDeparture] = useState<Departure | null>(() => {
    const d = loadDeparture()
    if (isDepartureExpired(d)) {
      clearDeparture()
      return null
    }
    return d
  })

  // 出発記録の期限切れ（12 時間）は、アプリを開きっぱなしでも「いま」が進んだら消す（C4）
  useEffect(() => {
    if (departure && isDepartureExpired(departure, nowDate)) {
      clearDeparture()
      setDeparture(null)
    }
  }, [departure, nowDate])

  const todayKey = rideDateKey(nowDate)
  const today = rideToday(nowDate)
  const streak = computeStreak(rides, today)
  const best = computeBestStreak(rides)
  const weekCount = countThisWeek(rides, today)
  const visited = useMemo(() => visitedPlaceIds(rides), [rides])
  const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites])
  const stamps = useMemo(() => stampsFromRides(rides), [rides])

  const record = useCallback(
    (p: RidePlace, minutes: number, date: string): RideOutcome => {
      const before = loadRides()
      const wasVisited = before.some((r) => r.placeId === p.id)
      const goalBefore = countThisWeek(before, rideToday(now())) >= weeklyGoal
      const next = addRide({ placeId: p.id, name: p.name, minutes, category: p.category, date })
      setRides(next)
      const t = rideToday(now())
      const weekCount = countThisWeek(next, t)
      return {
        kind: 'added',
        streak: computeStreak(next, t),
        weekCount,
        newStamp: !wasVisited,
        goalReached: !goalBefore && weekCount >= weeklyGoal,
      }
    },
    [now, weeklyGoal],
  )

  /** 詳細の「走った！」: 今日はトグル（取り消し可）、昨日の分は追加のみ（A7） */
  const toggleRide = useCallback(
    (p: RidePlace, minutes: number, when: 'today' | 'yesterday'): RideOutcome => {
      const key = rideDateKey(now())
      const date = when === 'today' ? key : previousDateKey(key)
      if (hasRideOn(loadRides(), p.id, date)) {
        setRides(removeRide(p.id, date))
        return { kind: 'removed' }
      }
      return record(p, minutes, date)
    },
    [now, record],
  )

  const deleteRide = useCallback((placeId: string, date: string) => setRides(removeRide(placeId, date)), [])

  const toggleFav = useCallback((p: Parameters<typeof toggleFavorite>[0]) => setFavorites(toggleFavorite(p)), [])

  const depart = useCallback(
    (p: RidePlace, plannedMin: number) => {
      const d: Departure = { placeId: p.id, name: p.name, category: p.category, at: now().toISOString(), plannedMin: Math.round(plannedMin) }
      saveDeparture(d)
      setDeparture(d)
    },
    [now],
  )

  /** 「行ってきた？」への回答。走った = 出発した日の分として記録 */
  const answerReturn = useCallback(
    (rode: boolean): RideOutcome | null => {
      const d = departure
      clearDeparture()
      setDeparture(null)
      if (!d || !rode) return null
      const date = rideDateKey(new Date(d.at))
      if (hasRideOn(loadRides(), d.placeId, date)) return null
      return record({ id: d.placeId, name: d.name, category: d.category ?? 'other' }, d.plannedMin, date)
    },
    [departure, record],
  )

  return {
    rides,
    todayKey,
    yesterdayKey: previousDateKey(todayKey),
    today,
    streak,
    best,
    weekCount,
    visited,
    favoriteIds,
    stamps,
    departure,
    toggleRide,
    deleteRide,
    toggleFav,
    depart,
    answerReturn,
  }
}

/** 記録後のトースト文言（DESIGN §6） */
export function rideToast(o: RideOutcome, name: string): string {
  if (o.kind === 'removed') return '記録を取り消したよ'
  if (o.goalReached) return '今週の目標クリア 🎉 えらすぎる'
  if (o.newStamp) return `新しいスタンプ GET！ ${name}`
  if (o.streak >= 2) return `🔥 ${o.streak}日連続！その調子`
  return `ナイスライド！今週${o.weekCount}回目`
}
