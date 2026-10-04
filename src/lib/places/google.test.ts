import { describe, expect, it } from 'vitest'
import { jsonResponse, mockFetch } from '../../test/fetchMock'
import { destinationPoint } from '../geo'
import { categorizeGoogleTypes, createGoogleProvider, GOOGLE_NEARBY_URL, GOOGLE_TYPE_GROUPS, googlePhotoUrl } from './google'

const C = { lat: 35.681236, lng: 139.767125 }

function gplace(id: string, name: string, bearing: number, km: number, primaryType: string, photo?: string) {
  const p = destinationPoint(C, bearing, km)
  return {
    id,
    displayName: { text: name, languageCode: 'ja' },
    location: { latitude: p.lat, longitude: p.lng },
    primaryType,
    types: [primaryType, 'point_of_interest'],
    photos: photo ? [{ name: photo }] : undefined,
  }
}

describe('google provider', () => {
  it('builds photo media URL', () => {
    expect(googlePhotoUrl('places/abc/photos/xyz', 'KEY')).toBe(
      'https://places.googleapis.com/v1/places/abc/photos/xyz/media?maxWidthPx=800&key=KEY',
    )
  })

  it('categorizes by primaryType then types', () => {
    expect(categorizeGoogleTypes('coffee_shop')).toBe('cafe')
    expect(categorizeGoogleTypes('store', ['bakery'])).toBe('bakery')
    expect(categorizeGoogleTypes('store', ['food'])).toBe('other')
  })

  it('calls searchNearby per type group with key + field mask headers and maps results', async () => {
    const f = mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body))
      if (body.includedTypes.includes('park')) {
        return jsonResponse({ places: [gplace('P1', '日比谷公園', 200, 3, 'park', 'places/P1/photos/ph1'), gplace('P2', '近い公園', 0, 0.5, 'park')] })
      }
      if (body.includedTypes.includes('cafe')) return jsonResponse({ places: [gplace('C1', '丸の内珈琲', 45, 3.2, 'cafe')] })
      if (body.includedTypes.includes('observation_deck')) return jsonResponse({ error: { message: 'bad type' } }, 400)
      return jsonResponse({})
    })
    const res = await createGoogleProvider({ apiKey: 'KEY' }).search(C, 2, 4)
    expect(f).toHaveBeenCalledTimes(GOOGLE_TYPE_GROUPS.length)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe(GOOGLE_NEARBY_URL)
    const headers = init?.headers as Record<string, string>
    expect(headers['X-Goog-Api-Key']).toBe('KEY')
    expect(headers['X-Goog-FieldMask']).toContain('places.photos')
    const body = JSON.parse(String(init?.body))
    expect(body.locationRestriction.circle.radius).toBe(4000)
    expect(body.locationRestriction.circle.center).toEqual({ latitude: C.lat, longitude: C.lng })

    expect(res.map((p) => p.id).sort()).toEqual(['google:C1', 'google:P1'])
    const park = res.find((p) => p.id === 'google:P1')!
    expect(park.category).toBe('park')
    expect(park.source).toBe('google')
    expect(park.photoUrl).toBe('https://places.googleapis.com/v1/places/P1/photos/ph1/media?maxWidthPx=800&key=KEY')
    expect(park.tags?.google_place_id).toBe('P1')
  })

  it('throws when every request fails', async () => {
    mockFetch(() => jsonResponse({}, 403))
    await expect(createGoogleProvider({ apiKey: 'BAD' }).search(C, 2, 4)).rejects.toThrow(/403/)
  })
})
