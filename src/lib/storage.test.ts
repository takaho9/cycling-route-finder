import { describe, expect, it } from 'vitest'
import {
  addRide,
  computeStreak,
  countThisWeek,
  DEFAULT_SETTINGS,
  loadFavorites,
  loadRides,
  loadSettings,
  readJson,
  saveSettings,
  STORAGE_KEYS,
  toDateKey,
  toggleFavorite,
  visitedPlaceIds,
  writeJson,
} from './storage'

const d = (s: string) => {
  const [y, m, day] = s.split('-').map(Number)
  return new Date(y, m - 1, day, 12)
}
const rides = (...dates: string[]) => dates.map((date) => ({ date }))

describe('computeStreak', () => {
  const today = d('2026-10-04')
  it('0 with no rides', () => expect(computeStreak([], today)).toBe(0))
  it('counts consecutive days ending today', () => {
    expect(computeStreak(rides('2026-10-04', '2026-10-03', '2026-10-02', '2026-09-30'), today)).toBe(3)
  })
  it('still alive if last ride was yesterday', () => {
    expect(computeStreak(rides('2026-10-03', '2026-10-02'), today)).toBe(2)
  })
  it('broken if last ride was 2 days ago', () => {
    expect(computeStreak(rides('2026-10-02', '2026-10-01'), today)).toBe(0)
  })
  it('multiple rides on the same day count once; crosses month boundary', () => {
    expect(computeStreak(rides('2026-10-01', '2026-10-01', '2026-09-30', '2026-09-29'), d('2026-10-01'))).toBe(3)
  })
})

describe('countThisWeek', () => {
  // 2026-10-04 is a Sunday
  const sunday = d('2026-10-04')
  it('Monday-start week includes Mon 9/28 .. Sun 10/4', () => {
    const r = rides('2026-09-27', '2026-09-28', '2026-10-01', '2026-10-01', '2026-10-04', '2026-10-05')
    expect(countThisWeek(r, sunday)).toBe(4)
    expect(countThisWeek(r, sunday, { countDistinctDays: true })).toBe(3)
  })
  it('Sunday-start week', () => {
    const r = rides('2026-10-03', '2026-10-04', '2026-10-05')
    expect(countThisWeek(r, sunday, { weekStartsOn: 0 })).toBe(2)
  })
  it('ignores malformed dates', () => {
    expect(countThisWeek(rides('bad', '2026-10-04'), sunday)).toBe(1)
  })
})

describe('toDateKey / visited', () => {
  it('formats local date', () => {
    expect(toDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
  it('visitedPlaceIds', () => {
    expect([...visitedPlaceIds([{ placeId: 'a' }, { placeId: 'b' }, { placeId: 'a' }])].sort()).toEqual(['a', 'b'])
  })
})

describe('persistence', () => {
  it('settings round-trip and validation', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
    saveSettings({ speedPreset: 'fast' })
    expect(loadSettings().speedPreset).toBe('fast')
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ speedPreset: 'warp' }))
    expect(loadSettings().speedPreset).toBe('normal')
    localStorage.setItem(STORAGE_KEYS.settings, '{not json')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })
  it('rides', () => {
    addRide({ placeId: 'osm:node/1', name: '公園', minutes: 30 }, undefined, new Date(2026, 9, 4))
    addRide({ placeId: 'osm:node/2', name: '珈琲', minutes: 45, date: '2026-10-03' })
    expect(loadRides()).toEqual([
      { placeId: 'osm:node/1', name: '公園', minutes: 30, date: '2026-10-04' },
      { placeId: 'osm:node/2', name: '珈琲', minutes: 45, date: '2026-10-03' },
    ])
    localStorage.setItem(STORAGE_KEYS.rides, JSON.stringify([{ bogus: 1 }, { date: '2026-10-01', placeId: 'x', name: 'x', minutes: 15 }]))
    expect(loadRides()).toHaveLength(1)
  })
  it('favorites toggle', () => {
    const p = { id: 'a', name: 'A', lat: 1, lng: 2, category: 'park' as const }
    expect(toggleFavorite(p)).toHaveLength(1)
    expect(loadFavorites()[0]).toEqual(p)
    expect(toggleFavorite(p)).toHaveLength(0)
  })
  it('never throws when storage is broken', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    } as unknown as Storage
    expect(readJson('k', 7, broken)).toBe(7)
    expect(writeJson('k', 1, broken)).toBe(false)
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS)
    expect(loadRides(broken)).toEqual([])
    expect(() => addRide({ placeId: 'a', name: 'a', minutes: 1 }, broken)).not.toThrow()
    expect(writeJson('k', 1, null)).toBe(false)
  })
})
