import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { summarizeElevation } from '../lib/elevation'
import type { Category, Place } from '../lib/types'
import { useStableRecommendations } from './useRecommendations'

const cats: Category[] = ['park', 'cafe', 'shrine', 'museum', 'bakery', 'historic', 'viewpoint', 'sweets']
const places: Place[] = cats.map((category, i) => ({
  id: `p${i}`,
  name: `場所${i}`,
  lat: 35.7,
  lng: 139.7,
  category,
  distanceKm: 3,
  bearing: 0,
  source: 'overpass',
}))
const SEA = summarizeElevation([5, 0, 0, 0, 5], 4)

describe('useStableRecommendations (C7)', () => {
  it('keeps the same 3 while the key is the same, even when elevation arrives or a ride is recorded', () => {
    const key = '2026-10-07|45|35.681,139.767|16'
    const { result, rerender } = renderHook(({ list, visited }) => useStableRecommendations(list, key, visited), {
      initialProps: { list: places, visited: new Set<string>() },
    })
    const first = result.current
    expect(first).toHaveLength(3)
    // 標高が届く（新しいオブジェクト・水面ペナルティ付き）
    rerender({ list: places.map((p) => ({ ...p, elevation: SEA })), visited: new Set<string>() })
    expect(result.current).toEqual(first)
    // おすすめの 1 件を「走った」
    rerender({ list: places, visited: new Set([first[0]]) })
    expect(result.current).toEqual(first)
  })

  it('re-picks when the key changes (another day / time / origin / speed)', () => {
    const { result, rerender } = renderHook(({ key }) => useStableRecommendations(places, key, new Set()), {
      initialProps: { key: '2026-10-07|45|35.681,139.767|16' },
    })
    const days = new Set([result.current.join()])
    for (const d of ['08', '09', '10', '11', '12']) {
      rerender({ key: `2026-10-${d}|45|35.681,139.767|16` })
      days.add(result.current.join())
    }
    expect(days.size).toBeGreaterThan(1)
  })
})
