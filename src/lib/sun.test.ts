import { describe, expect, it } from 'vitest'
import { daylightStatus, sunTimes } from './sun'

const TOKYO = { lat: 35.681236, lng: 139.767125 }
const hm = (d: Date) => d.getHours() * 60 + d.getMinutes()

describe('sunTimes (Asia/Tokyo)', () => {
  it('Tokyo 2026-10-04: sunrise ≈ 5:38, sunset ≈ 17:24 (±3 min)', () => {
    const t = sunTimes(new Date(2026, 9, 4, 9), TOKYO)!
    expect(Math.abs(hm(t.sunrise) - (5 * 60 + 38))).toBeLessThanOrEqual(3)
    expect(Math.abs(hm(t.sunset) - (17 * 60 + 24))).toBeLessThanOrEqual(3)
  })
  it('Tokyo summer solstice sunset ≈ 19:00', () => {
    const t = sunTimes(new Date(2026, 5, 21, 9), TOKYO)!
    expect(Math.abs(hm(t.sunset) - (19 * 60))).toBeLessThanOrEqual(3)
  })
  it('polar night → null', () => {
    expect(sunTimes(new Date(2026, 11, 21), { lat: 80, lng: 0 })).toBeNull()
  })
})

describe('daylightStatus', () => {
  it('minutes to sunset and warning when returning after sunset', () => {
    const s = daylightStatus(new Date(2026, 9, 4, 16, 30), TOKYO, 60)
    expect(s.kind).toBe('day')
    if (s.kind !== 'day') return
    expect(s.minutesToSunset).toBeGreaterThan(50)
    expect(s.minutesToSunset).toBeLessThan(58)
    expect(s.returnsAfterSunset).toBe(true)
    expect((daylightStatus(new Date(2026, 9, 4, 12), TOKYO, 60) as { returnsAfterSunset: boolean }).returnsAfterSunset).toBe(false)
  })
  it('night', () => {
    expect(daylightStatus(new Date(2026, 9, 4, 20), TOKYO, 30).kind).toBe('night')
    expect(daylightStatus(new Date(2026, 9, 4, 4), TOKYO, 30).kind).toBe('night')
  })
})
