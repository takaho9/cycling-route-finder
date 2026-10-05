import { useEffect, useState } from 'react'

const systemNow = () => new Date()

/** 再評価の間隔（ms） */
export const NOW_TICK_MS = 60_000

/**
 * 「いま」を返す（BACKLOG-2 C4）。PWA は何時間も開きっぱなし・バックグラウンドから復帰することがあるので、
 * visibilitychange（表示に戻った）/ pageshow（bfcache 復帰）/ focus と 60 秒タイマーで再評価する。
 * 帰還カード・日没・おすすめの日付・出発記録の期限切れは、すべてこの値から計算する。
 */
export function useNow(clock: () => Date = systemNow, intervalMs = NOW_TICK_MS): Date {
  const [now, setNow] = useState(clock)
  useEffect(() => {
    const tick = () => setNow(clock())
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') tick()
    }
    tick()
    document.addEventListener('visibilitychange', onVisible)
    addEventListener('pageshow', tick)
    addEventListener('focus', tick)
    const t = setInterval(tick, intervalMs)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      removeEventListener('pageshow', tick)
      removeEventListener('focus', tick)
      clearInterval(t)
    }
  }, [clock, intervalMs])
  return now
}
