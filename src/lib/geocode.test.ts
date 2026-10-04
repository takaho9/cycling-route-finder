import { beforeEach, describe, expect, it } from 'vitest'
import { jsonResponse, mockFetch } from '../test/fetchMock'
import { geocode, resetGeocodeThrottle } from './geocode'

beforeEach(() => resetGeocodeThrottle())

describe('geocode (Nominatim, on submit only)', () => {
  it('builds the query and maps results', async () => {
    const f = mockFetch(() => jsonResponse([{ lat: '35.68', lon: '139.76', display_name: '東京駅, 丸の内, 千代田区', name: '東京駅' }]))
    expect(await geocode(' 東京駅 ')).toEqual([{ lat: 35.68, lng: 139.76, label: '東京駅' }])
    const u = new URL(String(f.mock.calls[0][0]))
    expect(u.host).toBe('nominatim.openstreetmap.org')
    expect(u.searchParams.get('q')).toBe('東京駅')
    expect(u.searchParams.get('countrycodes')).toBe('jp')
  })
  it('empty query does nothing', async () => {
    const f = mockFetch(() => jsonResponse([]))
    expect(await geocode('  ')).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })
  it('throttles to 1 request per second', async () => {
    mockFetch(() => jsonResponse([]))
    const t0 = Date.now()
    await geocode('a')
    await geocode('b')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000)
  })
})
