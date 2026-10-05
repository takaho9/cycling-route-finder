import { describe, expect, it } from 'vitest'
import {
  addRide,
  clearDeparture,
  isDepartureExpired,
  loadDeparture,
  longestStreak,
  previousDateKey,
  rideDateKey,
  rideToday,
  saveDeparture,
  shouldAskReturn,
  computeBestStreak,
  hasRideOn,
  loadFlag,
  loadRecentOrigins,
  pushRecentOrigin,
  removeRide,
  setFlag,
  stampsFromRides,
  weekActivity,
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
  loadLastResultNear,
  saveLastResult,
} from './storage'
import type { Place } from './types'

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
    saveSettings({ ...DEFAULT_SETTINGS, speedPreset: 'fast', weeklyGoal: 5, lastMinutes: 75 })
    expect(loadSettings()).toEqual({ speedPreset: 'fast', weeklyGoal: 5, lastMinutes: 75 })
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ speedPreset: 'fast', weeklyGoal: 99 }))
    expect(loadSettings().weeklyGoal).toBe(3)
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({ speedPreset: 'warp' }))
    expect(loadSettings().speedPreset).toBe('normal')
    localStorage.setItem(STORAGE_KEYS.settings, '{not json')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })
  it('rides', () => {
    addRide({ placeId: 'osm:node/1', name: '公園', minutes: 30 }, undefined, new Date(2026, 9, 4, 12))
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

describe('habit helpers', () => {
  it('computeBestStreak', () => {
    expect(computeBestStreak([])).toBe(0)
    expect(computeBestStreak(rides('2026-09-01', '2026-09-02', '2026-09-03', '2026-09-10', '2026-09-30', '2026-10-01'))).toBe(3)
    expect(computeBestStreak(rides('2026-10-01', '2026-10-01'))).toBe(1)
  })
  it('weekActivity marks rode / not / future (Monday start)', () => {
    const w = weekActivity(rides('2026-09-28', '2026-09-30'), d('2026-10-01'))
    expect(w.map((x) => x.date)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
    expect(w.map((x) => x.rode)).toEqual([true, false, true, false, null, null, null])
  })
  it('stampsFromRides keeps first visit per place, newest first', () => {
    const r = [
      { date: '2026-10-01', placeId: 'a', name: 'A', minutes: 30 },
      { date: '2026-09-01', placeId: 'a', name: 'A', minutes: 30 },
      { date: '2026-09-15', placeId: 'b', name: 'B', minutes: 30 },
    ]
    expect(stampsFromRides(r).map((x) => [x.placeId, x.date])).toEqual([
      ['b', '2026-09-15'],
      ['a', '2026-09-01'],
    ])
  })
  it('removeRide / hasRideOn toggle today record', () => {
    addRide({ placeId: 'a', name: 'A', minutes: 30, date: '2026-10-04' })
    addRide({ placeId: 'a', name: 'A', minutes: 30, date: '2026-10-03' })
    expect(hasRideOn(loadRides(), 'a', '2026-10-04')).toBe(true)
    removeRide('a', '2026-10-04')
    expect(hasRideOn(loadRides(), 'a', '2026-10-04')).toBe(false)
    expect(loadRides()).toHaveLength(1)
  })
  it('recent origins dedupe and cap at 3', () => {
    for (const [i, lat] of [35, 36, 37, 35, 38].entries()) pushRecentOrigin({ lat, lng: 139, label: `p${i}` })
    expect(loadRecentOrigins().map((o) => o.lat)).toEqual([38, 35, 37])
  })
  it('flags', () => {
    expect(loadFlag('x')).toBe(false)
    setFlag('x')
    expect(loadFlag('x')).toBe(true)
  })
})

describe('day boundary (0-4am counts as the previous day)', () => {
  it('rideDateKey', () => {
    expect(rideDateKey(new Date(2026, 9, 4, 3, 59))).toBe('2026-10-03')
    expect(rideDateKey(new Date(2026, 9, 4, 4, 0))).toBe('2026-10-04')
    expect(rideDateKey(new Date(2026, 9, 1, 1, 0))).toBe('2026-09-30')
  })
  it('rideToday / previousDateKey', () => {
    expect(toDateKey(rideToday(new Date(2026, 9, 4, 2)))).toBe('2026-10-03')
    expect(previousDateKey('2026-10-01')).toBe('2026-09-30')
  })
  it('addRide uses the ride date', () => {
    addRide({ placeId: 'a', name: 'A', minutes: 30 }, undefined, new Date(2026, 9, 4, 1, 30))
    expect(loadRides()[0].date).toBe('2026-10-03')
  })
  it('runs in Asia/Tokyo', () => {
    expect(new Date('2026-10-03T15:30:00Z').getHours()).toBe(0)
  })
  it('longestStreak alias', () => {
    expect(longestStreak(rides('2026-10-01', '2026-10-02'))).toBe(2)
  })
})

describe('departure → "行ってきた？"', () => {
  const dep = { placeId: 'p', name: '代々木公園', at: new Date(2026, 9, 4, 10, 0).toISOString(), plannedMin: 60 }
  it('asks between planned×0.5 and 12h', () => {
    expect(shouldAskReturn(dep, new Date(2026, 9, 4, 10, 29))).toBe(false)
    expect(shouldAskReturn(dep, new Date(2026, 9, 4, 10, 30))).toBe(true)
    expect(shouldAskReturn(dep, new Date(2026, 9, 4, 22, 0))).toBe(true)
    expect(shouldAskReturn(dep, new Date(2026, 9, 4, 22, 1))).toBe(false)
    expect(isDepartureExpired(dep, new Date(2026, 9, 4, 22, 1))).toBe(true)
    expect(shouldAskReturn(null)).toBe(false)
  })
  it('persists and clears', () => {
    saveDeparture(dep)
    expect(loadDeparture()).toEqual(dep)
    clearDeparture()
    expect(loadDeparture()).toBeNull()
  })
})

describe('last result for offline (C5)', () => {
  const place = (id: string): Place => ({ id, name: id, lat: 35.7, lng: 139.8, category: 'park', distanceKm: 3, bearing: 0, source: 'overpass' })
  const at = { lat: 35.6812, lng: 139.7671 }
  it('is used only when the origin is within 1km of where it was saved', () => {
    saveLastResult({ origin: at, places: [place('a')], source: 'overpass', savedAt: '2026-10-07T00:00:00Z' })
    expect(loadLastResultNear({ lat: at.lat + 0.008, lng: at.lng })?.places).toHaveLength(1) // ~0.9km
    expect(loadLastResultNear({ lat: at.lat + 0.01, lng: at.lng })).toBeNull() // ~1.1km
    expect(loadLastResultNear({ lat: 34.70, lng: 135.49 })).toBeNull() // 大阪
  })
  it('broken data is ignored', () => {
    localStorage.setItem(STORAGE_KEYS.lastResult, JSON.stringify({ places: [] }))
    expect(loadLastResultNear(at)).toBeNull()
  })
})
