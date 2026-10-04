import { describe, expect, it } from 'vitest'
import { buildOneWayUrl, buildRoundTripUrl } from './gmaps'

const O = { lat: 35.681236, lng: 139.767125 }
const D = { lat: 35.6585812, lng: 139.7454329 }

describe('Google Maps URLs', () => {
  it('one-way bicycling URL', () => {
    const url = buildOneWayUrl({ origin: O, destination: D })
    expect(url).toBe(
      'https://www.google.com/maps/dir/?api=1&origin=35.681236%2C139.767125&destination=35.658581%2C139.745433&travelmode=bicycling',
    )
    const u = new URL(url)
    expect(u.searchParams.get('origin')).toBe('35.681236,139.767125')
    expect(u.searchParams.get('travelmode')).toBe('bicycling')
  })
  it('omits origin when unknown (Maps uses current location)', () => {
    const u = new URL(buildOneWayUrl({ destination: D }))
    expect(u.searchParams.has('origin')).toBe(false)
    expect(u.searchParams.get('destination')).toBe('35.658581,139.745433')
  })
  it('round trip: origin = destination = current location, waypoint = place', () => {
    const u = new URL(buildRoundTripUrl({ origin: O, destination: D }))
    expect(u.searchParams.get('api')).toBe('1')
    expect(u.searchParams.get('origin')).toBe('35.681236,139.767125')
    expect(u.searchParams.get('destination')).toBe('35.681236,139.767125')
    expect(u.searchParams.get('waypoints')).toBe('35.658581,139.745433')
    expect(u.searchParams.get('travelmode')).toBe('bicycling')
  })
  it('always uses coordinates (no API key / place id needed)', () => {
    const u = buildRoundTripUrl({ origin: { lat: -33.5, lng: -70.25 }, destination: D })
    expect(u).toContain('origin=-33.500000%2C-70.250000')
    expect(u).not.toContain('place_id')
  })
})
