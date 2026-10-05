import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NOW_TICK_MS, useNow } from './useNow'

describe('useNow (C4)', () => {
  it('re-evaluates every 60 seconds', () => {
    vi.useFakeTimers()
    let t = new Date('2026-10-07T15:00:00+09:00')
    const clock = () => t
    const { result } = renderHook(() => useNow(clock))
    expect(result.current.toISOString()).toBe(t.toISOString())
    t = new Date('2026-10-07T15:01:00+09:00')
    act(() => vi.advanceTimersByTime(NOW_TICK_MS))
    expect(result.current.toISOString()).toBe(t.toISOString())
  })

  it.each([
    ['visibilitychange', () => document.dispatchEvent(new Event('visibilitychange'))],
    ['pageshow', () => window.dispatchEvent(new Event('pageshow'))],
    ['focus', () => window.dispatchEvent(new Event('focus'))],
  ])('re-evaluates on %s (back from the background)', (_name, fire) => {
    let t = new Date('2026-10-07T15:00:00+09:00')
    const clock = () => t
    const { result } = renderHook(() => useNow(clock, 10 * 60_000))
    t = new Date('2026-10-08T07:30:00+09:00') // 翌朝に復帰
    act(() => fire())
    expect(result.current.toISOString()).toBe(t.toISOString())
  })
})
