import { describe, expect, it } from 'vitest'
import { buildOneWayUrl, buildRoundTripUrl, googlePlaceIdFromId } from './gmaps'

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
  it('encodes place ids safely', () => {
    const u = buildOneWayUrl({ destination: D, destinationPlaceId: 'ChIJ a&b=c' })
    expect(u).toContain('destination_place_id=ChIJ%20a%26b%3Dc')
    expect(new URL(u).searchParams.get('destination_place_id')).toBe('ChIJ a&b=c')
    expect(new URL(buildRoundTripUrl({ origin: O, destination: D, destinationPlaceId: 'X' })).searchParams.get('waypoint_place_ids')).toBe('X')
  })
  it('googlePlaceIdFromId', () => {
    expect(googlePlaceIdFromId('google:ChIJ123')).toBe('ChIJ123')
    expect(googlePlaceIdFromId('osm:node/1')).toBeUndefined()
  })
})
