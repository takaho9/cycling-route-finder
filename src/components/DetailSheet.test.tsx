import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoServices } from '../lib/services'
import { DetailSheet } from './DetailSheet'
import type { ViewPlace } from './types'

const origin = { lat: 35.68123456, lng: 139.76712345 }
const place: ViewPlace = {
  id: 'mock:test-1',
  name: '富士見展望台',
  lat: 35.7012346,
  lng: 139.7456789,
  category: 'viewpoint',
  distanceKm: 3,
  bearing: 315,
  source: 'mock',
  elevationState: 'loading',
  visited: false,
  favorite: false,
}

function renderSheet(over: Partial<Parameters<typeof DetailSheet>[0]> = {}) {
  const props = {
    place,
    origin,
    roundTripAllowed: true,
    services: demoServices,
    speedKmh: 16,
    minutes: 45,
    mode: 'round' as const,
    onMode: vi.fn(),
    rodeToday: false,
    rodeYesterday: false,
    stampKey: 0,
    onRode: vi.fn(),
    onGo: vi.fn(),
    onToggleFavorite: vi.fn(),
    onRouteElevation: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  render(<DetailSheet {...props} />)
  return props
}

const href = (name: RegExp | string) => new URL((screen.getByRole('link', { name }) as HTMLAnchorElement).href)

describe('DetailSheet', () => {
  it('round trip (default): Google Maps URL with no origin, destination = start (rounded), waypoints = place (R4)', async () => {
    const p = renderSheet()
    const u = href(/Googleマップで出発/)
    expect(u.origin + u.pathname).toBe('https://www.google.com/maps/dir/')
    expect(u.searchParams.get('api')).toBe('1')
    expect(u.searchParams.has('origin')).toBe(false)
    expect(u.searchParams.get('destination')).toBe('35.6812,139.7671')
    expect(u.searchParams.get('waypoints')).toBe('35.701235,139.745679')
    expect(u.searchParams.get('travelmode')).toBe('bicycling')
    const a = screen.getByRole('link', { name: /Googleマップで出発/ }) as HTMLAnchorElement
    expect(a.target).toBe('_blank')
    expect(a.rel).toBe('noopener')
    // デモの経路は直線なので確定値にはならない（C3）
    await waitFor(() => expect(p.onRouteElevation).toHaveBeenCalledWith(place.id, expect.objectContaining({ estimated: true })))
  })

  it('one way: no origin, dir_action=navigate; walking link as an alternative', () => {
    renderSheet({ mode: 'oneway' })
    const u = href(/Googleマップで出発/)
    expect(u.searchParams.has('origin')).toBe(false)
    expect(u.searchParams.has('waypoints')).toBe(false)
    expect(u.searchParams.get('destination')).toBe('35.701235,139.745679')
    expect(u.searchParams.get('dir_action')).toBe('navigate')
    const w = href('徒歩で開く')
    expect(w.searchParams.get('travelmode')).toBe('walking')
    expect(w.searchParams.get('destination')).toBe('35.701235,139.745679')
  })

  it('provisional (demo) origin: round trip disabled, one-way URL even if round was chosen (A6)', () => {
    renderSheet({ roundTripAllowed: false, mode: 'round' })
    expect(screen.getByRole('radio', { name: '往復でまわる' })).toHaveProperty('disabled', true)
    expect(href(/Googleマップで出発/).searchParams.has('waypoints')).toBe(false)
  })

  it('clicking the CTA records the departure; segment, ran and favourite call back', () => {
    const p = renderSheet()
    const a = screen.getByRole('link', { name: /Googleマップで出発/ })
    a.addEventListener('click', (e) => e.preventDefault())
    fireEvent.click(a)
    expect(p.onGo).toHaveBeenCalledWith(place, 'round')
    fireEvent.click(screen.getByRole('radio', { name: '片道で行く' }))
    expect(p.onMode).toHaveBeenCalledWith('oneway')
    fireEvent.click(screen.getByRole('button', { name: '✓ 走った！' }))
    expect(p.onRode).toHaveBeenCalledWith(place, 'today')
    fireEvent.click(screen.getByRole('button', { name: '昨日の分として記録' }))
    expect(p.onRode).toHaveBeenCalledWith(place, 'yesterday')
    fireEvent.click(screen.getByRole('button', { name: 'お気に入りに追加' }))
    expect(p.onToggleFavorite).toHaveBeenCalledWith(place)
  })

  it('is a modal dialog titled with the place; Esc closes', () => {
    const p = renderSheet()
    expect(screen.getByRole('dialog', { name: '富士見展望台' }).getAttribute('aria-modal')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(p.onClose).toHaveBeenCalled()
  })
})
