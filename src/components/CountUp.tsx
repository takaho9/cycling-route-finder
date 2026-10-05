import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '../hooks/useMedia'

/** 数字が変わったときにカウントアップ（D2）。初回は即表示。reduce-motion では即時切替 */
export function CountUp({ value, decimals = 0, duration = 600 }: { value: number; decimals?: number; duration?: number }) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(value)
  const prev = useRef(value)
  useEffect(() => {
    const from = prev.current
    prev.current = value
    if (from === value) return
    if (reduced || typeof requestAnimationFrame !== 'function') {
      setShown(value)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / duration)
      setShown(from + (value - from) * (1 - (1 - k) ** 3))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      setShown(value)
    }
  }, [value, reduced, duration])
  return <>{shown.toFixed(decimals)}</>
}

/** key が（初回以外で）変わってから ms のあいだ true（「経路で更新」ピル用, D2） */
export function useFlash(key: unknown, ms = 2000): boolean {
  const [on, setOn] = useState(false)
  const prev = useRef(key)
  useEffect(() => {
    if (Object.is(prev.current, key)) return
    prev.current = key
    setOn(true)
    const t = setTimeout(() => setOn(false), ms)
    return () => clearTimeout(t)
  }, [key, ms])
  return on
}

export function RouteUpdatedPill() {
  return (
    <span className="route-pill" role="status">
      経路で更新
    </span>
  )
}
