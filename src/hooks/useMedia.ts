import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const get = () => {
    try {
      return typeof matchMedia === 'function' && matchMedia(query).matches
    } catch {
      return false
    }
  }
  const [v, setV] = useState(get)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const m = matchMedia(query)
    const on = () => setV(m.matches)
    m.addEventListener?.('change', on)
    return () => m.removeEventListener?.('change', on)
  }, [query])
  return v
}

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)')

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    addEventListener('online', on)
    addEventListener('offline', off)
    return () => {
      removeEventListener('online', on)
      removeEventListener('offline', off)
    }
  }, [])
  return online
}

/** 短い触感フィードバック（reduce-motion 時はしない） */
export function vibrate(ms: number, reduced: boolean): void {
  if (reduced) return
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* ignore */
  }
}
