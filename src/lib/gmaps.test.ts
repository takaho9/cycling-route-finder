import { describe, expect, it } from 'vitest'
import { buildOneWayUrl, buildRoundTripUrl } from './gmaps'

const O = { lat: 35.68123456, lng: 139.76712345 }
const D = { lat: 35.6585812, lng: 139.7454329 }

describe('Google Maps URLs', () => {
  it('one-way: no origin (current location), bicycling, dir_action=navigate', () => {
    const url = buildOneWayUrl({ destination: D })
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=35.658581%2C139.745433&travelmode=bicycling&dir_action=navigate')
    const u = new URL(url)
    expect(u.searchParams.has('origin')).toBe(false)
    expect(u.searchParams.get('dir_action')).toBe('navigate')
  })
  it('walking alternative', () => {
    expect(new URL(buildOneWayUrl({ destination: D, travelmode: 'walking' })).searchParams.get('travelmode')).toBe('walking')
  })
  it('round trip: no origin, destination = start (rounded to 4 decimals), waypoints = place', () => {
    const u = new URL(buildRoundTripUrl({ start: O, destination: D }))
    expect(u.searchParams.get('api')).toBe('1')
    expect(u.searchParams.has('origin')).toBe(false)
    expect(u.searchParams.get('destination')).toBe('35.6812,139.7671')
    expect(u.searchParams.get('waypoints')).toBe('35.658581,139.745433')
    expect(u.searchParams.get('travelmode')).toBe('bicycling')
  })
  it('encodes negative coordinates safely', () => {
    expect(buildRoundTripUrl({ start: { lat: -33.5, lng: -70.25 }, destination: D })).toContain('destination=-33.5000%2C-70.2500')
  })
})
