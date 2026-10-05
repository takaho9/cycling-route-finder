import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SearchResult } from '../lib/places'
import { demoServices, type Services } from '../lib/services'
import { loadLastResult, saveLastResult } from '../lib/storage'
import type { Place } from '../lib/types'
import { usePlaceSearch } from './usePlaceSearch'

const TOKYO = { lat: 35.6812, lng: 139.7671 }
const place = (id: string, km = 5): Place => ({ id, name: id, lat: 35.7, lng: 139.8, category: 'park', distanceKm: km, bearing: 0, source: 'overpass' })

function services(search: Services['search']): Services & { search: ReturnType<typeof vi.fn> } {
  return { ...demoServices, demo: false, search: vi.fn(search) }
}
const ok = (places: Place[]): SearchResult => ({ kind: 'ok', places, source: 'overpass', isDemo: false, errors: [] })
const demo: SearchResult = { kind: 'demo', places: [place('m1')], source: 'mock', isDemo: true, errors: [{ provider: 'overpass', error: new TypeError('x') }] }

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('usePlaceSearch', () => {
  it('passes the current speed and refetches when the speed changes (C1)', async () => {
    const s = services(async () => ok([place('a')]))
    const { rerender } = renderHook(({ kmh }) => usePlaceSearch(s, TOKYO, true, kmh), { initialProps: { kmh: 16 } })
    await waitFor(() => expect(s.search).toHaveBeenCalledTimes(1))
    expect(s.search.mock.calls[0][1]).toBe(16)
    rerender({ kmh: 20 })
    await waitFor(() => expect(s.search).toHaveBeenCalledTimes(2))
    expect(s.search.mock.calls[1][1]).toBe(20)
  })

  it('saves only the displayed top for offline use (C5)', async () => {
    const many = Array.from({ length: 300 }, (_, i) => place(`p${i}`, 1 + (i % 100) * 0.1))
    const s = services(async () => ok(many))
    const { result } = renderHook(() => usePlaceSearch(s, TOKYO, true, 16))
    await waitFor(() => expect(result.current.status).toBe('ok'))
    const saved = loadLastResult()!
    expect(saved.origin).toEqual(TOKYO)
    expect(saved.places.length).toBeLessThan(100)
  })

  it('offline: uses the previous result only when the origin is within 1km (C5)', async () => {
    saveLastResult({ origin: TOKYO, places: [place('saved')], source: 'overpass', savedAt: '2026-10-07T00:00:00Z' })
    const s = services(async () => demo)
    const near = renderHook(() => usePlaceSearch(s, { lat: TOKYO.lat + 0.005, lng: TOKYO.lng }, false, 16))
    expect(near.result.current).toMatchObject({ status: 'ok', stale: true })
    expect(near.result.current.result?.places.map((p) => p.id)).toEqual(['saved'])
    expect(s.search).not.toHaveBeenCalled()
    near.unmount()

    const far = renderHook(() => usePlaceSearch(s, { lat: 34.7025, lng: 135.496 }, false, 16))
    await waitFor(() => expect(far.result.current.status).toBe('demo'))
    expect(far.result.current.stale).toBe(false)
    expect(s.search).toHaveBeenCalledTimes(1)
  })

  it('fallen back to demo (not ?demo=1): retries automatically when the page becomes visible again (C6)', async () => {
    let calls = 0
    const s = services(async () => (++calls === 1 ? demo : ok([place('real')])))
    const { result } = renderHook(() => usePlaceSearch(s, TOKYO, true, 16))
    await waitFor(() => expect(result.current.status).toBe('demo'))
    expect(result.current.fallback).toBe(true)
    act(() => setVisibility('hidden'))
    expect(s.search).toHaveBeenCalledTimes(1)
    act(() => setVisibility('visible'))
    await waitFor(() => expect(result.current.status).toBe('ok'))
    expect(result.current.fallback).toBe(false)
    expect(s.search).toHaveBeenCalledTimes(2)
    // 実データになったら visible 復帰で再検索しない
    act(() => setVisibility('visible'))
    expect(s.search).toHaveBeenCalledTimes(2)
  })

  it('?demo=1 is never a "fallback" and does not auto-retry', async () => {
    const s = { ...demoServices, search: vi.fn(demoServices.search) }
    const { result } = renderHook(() => usePlaceSearch(s, TOKYO, true, 16))
    await waitFor(() => expect(result.current.status).toBe('demo'))
    expect(result.current.fallback).toBe(false)
    act(() => setVisibility('visible'))
    expect(s.search).toHaveBeenCalledTimes(1)
  })
})
