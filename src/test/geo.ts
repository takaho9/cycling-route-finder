import { vi } from 'vitest'

/** navigator.geolocation を差し替える（成功 / 拒否 / 未対応） */
export function mockGeolocation(result: { lat: number; lng: number; accuracy?: number } | 'denied' | 'unsupported') {
  if (result === 'unsupported') {
    Object.defineProperty(globalThis.navigator, 'geolocation', { value: undefined, configurable: true })
    return
  }
  const getCurrentPosition = vi.fn((ok: PositionCallback, ng?: PositionErrorCallback | null) => {
    if (result === 'denied') {
      ng?.({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError)
      return
    }
    ok({
      coords: { latitude: result.lat, longitude: result.lng, accuracy: result.accuracy ?? 20 },
      timestamp: Date.now(),
    } as GeolocationPosition)
  })
  Object.defineProperty(globalThis.navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true })
  return getCurrentPosition
}
