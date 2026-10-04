import { describe, expect, it } from 'vitest'
import {
  computeReach,
  DETOUR_FACTOR,
  estimateRoundTripMin,
  formatMinutesJa,
  isRouteOverBudget,
  roadBudgetKm,
  ROUND_TRIP_MINUTES,
  searchBand,
  SPEED_PRESETS,
} from './reach'

describe('computeReach', () => {
  it('30 min @ 16 km/h → 16 × 0.25h ÷ 1.3 ≈ 3.08 km', () => {
    const r = computeReach(30, SPEED_PRESETS.normal.kmh)
    expect(r.maxKm).toBeCloseTo(4 / 1.3, 6)
    expect(r.minKm).toBeCloseTo(r.maxKm * 0.7, 6)
    expect(r.bandMaxKm).toBeCloseTo(r.maxKm, 6)
  })
  it('scales linearly with time and speed', () => {
    expect(computeReach(90, 20).maxKm).toBeCloseTo(3 * computeReach(30, 20).maxKm, 6)
    expect(computeReach(60, 20).maxKm / computeReach(60, 12).maxKm).toBeCloseTo(20 / 12, 6)
  })
  it('respects custom detour factor', () => {
    expect(computeReach(60, 16, 1.25).maxKm).toBeCloseTo(8 / 1.25, 6)
  })
  it('returns zeros for invalid input', () => {
    expect(computeReach(0, 16)).toEqual({ maxKm: 0, minKm: 0, bandMaxKm: 0 })
    expect(computeReach(30, -1).maxKm).toBe(0)
    expect(computeReach(Number.NaN, 16).maxKm).toBe(0)
  })
  it('presets and time options match the PRD', () => {
    expect([SPEED_PRESETS.relaxed.kmh, SPEED_PRESETS.normal.kmh, SPEED_PRESETS.fast.kmh]).toEqual([12, 16, 20])
    expect(ROUND_TRIP_MINUTES).toEqual([15, 30, 45, 60, 75, 90])
    expect(DETOUR_FACTOR).toBe(1.3)
  })
})

describe('estimateRoundTripMin', () => {
  it('is the inverse of computeReach at the max distance', () => {
    for (const m of ROUND_TRIP_MINUTES) {
      const r = computeReach(m, 16)
      expect(estimateRoundTripMin(r.maxKm, 16)).toBeCloseTo(m, 6)
    }
  })
  it('does not apply detour for routed distances', () => {
    expect(estimateRoundTripMin(8, 16, { routed: true })).toBeCloseTo(60, 6)
    expect(estimateRoundTripMin(8, 16)).toBeCloseTo(78, 6)
  })
  it('adds +0.5 min per 10 m of round-trip climbing', () => {
    expect(estimateRoundTripMin(8, 16, { routed: true, gainRoundTripM: 100 })).toBeCloseTo(65, 6)
    expect(estimateRoundTripMin(8, 16, { routed: true, gainRoundTripM: -5 })).toBeCloseTo(60, 6)
  })
  it('returns 0 for invalid speed', () => {
    expect(estimateRoundTripMin(5, 0)).toBe(0)
  })
})

describe('formatMinutesJa', () => {
  it('formats', () => {
    expect(formatMinutesJa(15)).toBe('15分')
    expect(formatMinutesJa(60)).toBe('1時間')
    expect(formatMinutesJa(75)).toBe('1時間15分')
    expect(formatMinutesJa(89.6)).toBe('1時間30分')
  })
})

describe('budget / search band', () => {
  it('road budget = speed × T / 2', () => {
    expect(roadBudgetKm(60, 16)).toBeCloseTo(8, 6)
  })
  it('warns when route > budget × 1.2', () => {
    expect(isRouteOverBudget(9.6, 60, 16)).toBe(false)
    expect(isRouteOverBudget(9.61, 60, 16)).toBe(true)
  })
  it('search band covers every preset × time donut', () => {
    const band = searchBand()
    for (const p of Object.values(SPEED_PRESETS)) {
      for (const m of ROUND_TRIP_MINUTES) {
        const r = computeReach(m, p.kmh)
        expect(r.minKm).toBeGreaterThanOrEqual(band.minKm - 1e-9)
        expect(r.bandMaxKm).toBeLessThanOrEqual(band.maxKm + 1e-9)
      }
    }
  })
})
