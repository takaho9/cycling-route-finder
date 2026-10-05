/**
 * 実 API スモーク（任意・手動）。`npm run test:live` でのみ実行し、CI では動かさない（BACKLOG G3）。
 * 公開 API に配慮して、各 API 1 リクエスト程度の最小限にしている。
 */
import { describe, expect, it } from 'vitest'
import { fetchElevations } from './elevation'
import { geocode } from './geocode'
import { createOverpassProvider } from './places/overpass'
import { resolvePhotos } from './photos'
import { fetchRoute } from './routing'

const TOKYO = { lat: 35.6812, lng: 139.7671 }
const SHINJUKU = { lat: 35.6909, lng: 139.7003 }

describe('live public APIs', () => {
  it('Overpass returns named places around Tokyo Station (small radius)', async () => {
    const places = await createOverpassProvider().search(TOKYO, 0, 1.5)
    expect(places.length).toBeGreaterThan(0)
    expect(places[0].name).toBeTruthy()
  })

  it('Open-Meteo elevation', async () => {
    const e = await fetchElevations([TOKYO, SHINJUKU])
    expect(e?.every((v) => typeof v === 'number')).toBe(true)
  })

  it('FOSSGIS OSRM bike route (falls back to straight only if the server is down)', async () => {
    const r = await fetchRoute(TOKYO, SHINJUKU)
    expect(r.distanceKm).toBeGreaterThan(5)
    expect(r.source).toBe('osrm')
  })

  it('Wikidata/Commons photo for a well-known place', async () => {
    const m = await resolvePhotos([{ id: 'x', lat: 35.6586, lng: 139.7454, tags: { wikidata: 'Q39231' } }], { nearby: false })
    expect(m.get('x')?.url).toMatch(/^https:\/\/upload\.wikimedia\.org\//)
  })

  it('Nominatim geocode (on submit only)', async () => {
    const hits = await geocode('東京駅')
    expect(hits.length).toBeGreaterThan(0)
  })
})
