import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoServices } from '../lib/services'
import { POOR_ACCURACY_M, useOrigin } from './useOrigin'

type Call = { ok: PositionCallback; ng?: PositionErrorCallback | null; opts?: PositionOptions }

/** 呼ばれた getCurrentPosition を溜めておき、テストから好きな順で応答する */
function manualGeolocation() {
  const calls: Call[] = []
  const getCurrentPosition = vi.fn((ok: PositionCallback, ng?: PositionErrorCallback | null, opts?: PositionOptions) => {
    calls.push({ ok, ng, opts })
  })
  Object.defineProperty(globalThis.navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true })
  const pos = (lat: number, lng: number, accuracy = 20) => ({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp: 0 }) as GeolocationPosition
  const err = (code: number) => ({ code, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) as GeolocationPositionError
  return { calls, pos, err }
}

const services = { ...demoServices, placeName: async () => null }

describe('useOrigin (C9)', () => {
  it('drops a stale GPS result that arrives after a manual choice (generation)', () => {
    const g = manualGeolocation()
    const { result } = renderHook(() => useOrigin(services))
    act(() => result.current.choose({ lat: 34.7, lng: 135.5, label: '大阪駅', kind: 'manual' }))
    act(() => g.calls[0].ok(g.pos(35.68, 139.76)))
    expect(result.current.origin).toMatchObject({ label: '大阪駅', kind: 'manual' })
  })

  it('drops the result of an older locate() when a newer one is running', () => {
    const g = manualGeolocation()
    const { result } = renderHook(() => useOrigin(services))
    act(() => result.current.locate())
    act(() => g.calls[1].ok(g.pos(35.1, 139.1)))
    act(() => g.calls[0].ok(g.pos(35.9, 139.9))) // 古い方が後から届く
    expect(result.current.origin).toMatchObject({ lat: 35.1, lng: 139.1 })
  })

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ] as const)('error code %i → %s', (code, kind) => {
    const g = manualGeolocation()
    const { result } = renderHook(() => useOrigin(services))
    act(() => g.calls[0].ng?.(g.err(code)))
    expect(result.current.status).toBe('denied')
    expect(result.current.error).toBe(kind)
    expect(result.current.origin).toBeNull()
  })

  it('accuracy worse than 500m → re-requests with high accuracy and takes the better fix', () => {
    const g = manualGeolocation()
    const { result } = renderHook(() => useOrigin(services))
    expect(g.calls[0].opts?.enableHighAccuracy).toBe(false)
    act(() => g.calls[0].ok(g.pos(35.6, 139.6, POOR_ACCURACY_M + 700)))
    expect(result.current.origin).toMatchObject({ lat: 35.6, accuracyM: 1200 })
    expect(g.calls).toHaveLength(2)
    expect(g.calls[1].opts).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 })
    act(() => g.calls[1].ok(g.pos(35.61, 139.61, 15)))
    expect(result.current.origin).toMatchObject({ lat: 35.61, accuracyM: 15 })
  })

  it('a good first fix does not re-request', () => {
    const g = manualGeolocation()
    renderHook(() => useOrigin(services))
    act(() => g.calls[0].ok(g.pos(35.6, 139.6, 30)))
    expect(g.calls).toHaveLength(1)
  })
})
