import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom は scrollTo を実装していない（呼ぶとエラーログが出る）
window.scrollTo = (() => {}) as typeof window.scrollTo

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})
