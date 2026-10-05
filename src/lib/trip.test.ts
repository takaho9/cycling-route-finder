import { describe, expect, it } from 'vitest'
import { summarizeElevation } from './elevation'
import { estimateRoundTripMin } from './reach'
import { roundTripMinutes, tripEstimate } from './trip'

describe('roundTripMinutes (D2)', () => {
  it.each([
    [0, 0],
    [0.4, 1],
    [7.4, 7],
    [14.4, 14],
    [14.6, 15],
    [17.4, 15],
    [17.6, 20],
    [42, 40],
    [43, 45],
    [88, 90],
  ])('%f → %i', (raw, expected) => {
    expect(roundTripMinutes(raw)).toBe(expected)
  })
})

describe('tripEstimate (D2: one function for card / gacha / detail / departure)', () => {
  const elevation = summarizeElevation([10, 20, 30, 20, 40], 4) // 行き +40m / 帰り +10m（ノイズ閾値 5m）
  const place = { distanceKm: 4, elevation }

  it('estimate: straight × detour, round trip time includes the climb penalty', () => {
    const t = tripEstimate(place, 'round', 16)
    expect(t.routed).toBe(false)
    expect(t.oneWayKm).toBeCloseTo(5.2, 6)
    expect(t.km).toBeCloseTo(10.4, 6)
    expect(t.gainM).toBe(Math.round(elevation.gainRoundTripM))
    expect(t.rawMinutes).toBeCloseTo(estimateRoundTripMin(4, 16, { gainRoundTripM: elevation.gainRoundTripM }), 6)
    expect(t.minutes % 5).toBe(0)
  })

  it('one way uses the outbound climb only', () => {
    const t = tripEstimate(place, 'oneway', 16)
    expect(t.km).toBeCloseTo(5.2, 6)
    expect(t.gainM).toBe(Math.round(elevation.gainOneWayM))
    expect(t.rawMinutes).toBeCloseTo((5.2 / 16) * 60 + (elevation.gainOneWayM / 10) * 0.5, 6)
    expect(t.climbM).toBe(Math.round(elevation.climbM))
  })

  it('v1.2: round trip climb = outbound up + return up (> one-way); G = max of the two', () => {
    // 山を越えて少し下った先が目的地（デモの「白山美術館」と同じ形）: 行き +22.9m / 帰り +5.4m
    const e = summarizeElevation([67.6, 69.6, 73.4, 78.2, 83.2, 87.4, 90, 90.5, 88.8, 85.1], 3.4)
    const round = tripEstimate({ distanceKm: 3.4, elevation: e }, 'round', 16)
    const oneway = tripEstimate({ distanceKm: 3.4, elevation: e }, 'oneway', 16)
    expect(oneway.gainM).toBe(23)
    expect(round.gainM).toBe(28)
    expect(round.gainM!).toBeGreaterThan(oneway.gainM!)
    // G は往復/片道どちらでも同じ（ラベル・サブ行用）
    expect(round.climbM).toBe(23)
    expect(oneway.climbM).toBe(23)
    // 上りペナルティ: その mode の獲得標高 10m ごとに +0.5 分
    expect(round.rawMinutes - (round.km / 16) * 60).toBeCloseTo((e.gainRoundTripM / 10) * 0.5, 6)
    expect(oneway.rawMinutes - (oneway.km / 16) * 60).toBeCloseTo((e.gainOneWayM / 10) * 0.5, 6)
  })

  it('a route distance replaces the estimate', () => {
    const t = tripEstimate({ ...place, routeKm: 6.1 }, 'round', 16)
    expect(t.routed).toBe(true)
    expect(t.oneWayKm).toBe(6.1)
    expect(t.km).toBeCloseTo(12.2, 6)
  })

  it('no elevation → no penalty, gain null', () => {
    const t = tripEstimate({ distanceKm: 1 }, 'round', 12)
    expect(t.gainM).toBeNull()
    expect(t.rawMinutes).toBeCloseTo((2.6 / 12) * 60, 6)
    expect(tripEstimate({ distanceKm: 3.74 }, 'round', 16)).toMatchObject({ oneWayKm: 4.9, km: 9.8 })
    expect(t.minutes).toBe(13) // 15 分未満は 1 分単位
  })
})
