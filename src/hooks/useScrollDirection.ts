import { useEffect, useState } from 'react'

/**
 * 下にスクロール中なら true、上にスクロールしたら false（FAB の出し入れ, BACKLOG-2 D4）。
 * 小さな揺れ（threshold px 未満）は無視。ページ先頭付近では常に false。
 */
export function useScrollDirection(enabled = true, threshold = 8): boolean {
  const [down, setDown] = useState(false)
  useEffect(() => {
    if (!enabled) {
      setDown(false)
      return
    }
    let last = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      if (y < 64) setDown(false)
      else if (y - last > threshold) setDown(true)
      else if (last - y > threshold) setDown(false)
      else return
      last = y
    }
    addEventListener('scroll', onScroll, { passive: true })
    return () => removeEventListener('scroll', onScroll)
  }, [enabled, threshold])
  return down
}
