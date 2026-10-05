import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoServices, type Services } from '../lib/services'
import { tripEstimate } from '../lib/trip'
import { DetailSheet } from './DetailSheet'
import type { Origin, ViewPlace } from './types'

const origin: Origin = { lat: 35.68123456, lng: 139.76712345, label: '現在地', kind: 'gps' }
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

/** デモの経路を OSRM で取れたことにする（経路距離 4.2km） */
const routedServices: Services = {
  ...demoServices,
  async routeDetail(o, p) {
    const r = await demoServices.routeDetail(o, p)
    return { route: { ...r.route, source: 'osrm', distanceKm: 4.2 }, elevation: r.elevation && { ...r.elevation, estimated: false } }
  },
}

function renderSheet(over: Partial<Parameters<typeof DetailSheet>[0]> = {}) {
  const props = {
    place,
    origin,
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
    onRouteResult: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
  const r = render(<DetailSheet {...props} />)
  return { ...props, rerender: (o: Partial<Parameters<typeof DetailSheet>[0]>) => r.rerender(<DetailSheet {...props} {...o} />) }
}

const href = (name: RegExp | string) => new URL((screen.getByRole('link', { name }) as HTMLAnchorElement).href)

describe('DetailSheet', () => {
  it('round trip (default, GPS): Google Maps URL with no origin, destination = start (rounded), waypoints = place (R4)', () => {
    renderSheet()
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
  })

  it('one way (GPS): no origin, dir_action=navigate; walking link as an alternative', () => {
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

  it('C10: a manually chosen start is explicit as origin= (one way and round trip)', () => {
    const manual: Origin = { ...origin, label: '二子玉川駅', kind: 'manual' }
    const s = renderSheet({ origin: manual, mode: 'oneway' })
    expect(href(/Googleマップで出発/).searchParams.get('origin')).toBe('35.6812,139.7671')
    expect(href('徒歩で開く').searchParams.get('origin')).toBe('35.6812,139.7671')
    s.rerender({ origin: manual, mode: 'round' })
    const u = href(/Googleマップで出発/)
    expect(u.searchParams.get('origin')).toBe('35.6812,139.7671')
    expect(u.searchParams.get('destination')).toBe('35.6812,139.7671')
    expect(u.searchParams.get('waypoints')).toBe('35.701235,139.745679')
  })

  it('provisional (demo) origin: round trip disabled, one-way URL even if round was chosen (A6)', () => {
    renderSheet({ origin: { ...origin, kind: 'demo' }, mode: 'round' })
    expect(screen.getByRole('radio', { name: '往復でまわる' })).toHaveProperty('disabled', true)
    expect(href(/Googleマップで出発/).searchParams.has('waypoints')).toBe(false)
  })

  it('C3: a straight-line route (demo) is not reflected to the list', async () => {
    const p = renderSheet()
    await screen.findByText(/道のりは直線から推定/)
    expect(p.onRouteResult).not.toHaveBeenCalled()
  })

  it('C3/D2: an OSRM route is reflected (distance + route elevation) and the numbers update with a "経路で更新" pill', async () => {
    const p = renderSheet({ services: routedServices })
    await waitFor(() => expect(p.onRouteResult).toHaveBeenCalledWith(place.id, expect.objectContaining({ km: 4.2 })))
    expect(vi.mocked(p.onRouteResult).mock.calls[0][1].elevation?.estimated).toBe(false)
    expect(await screen.findByText('経路で更新')).toBeTruthy()
    await waitFor(() => expect(document.querySelector('.stats')?.textContent).toContain('8.4km')) // 往復 = 4.2 × 2
    expect(screen.queryByText(/直線から推定/)).toBeNull()
  })

  it('D2: shows exactly what tripEstimate returns (same as the card)', () => {
    const withElev: ViewPlace = { ...place, routeKm: 5.5, elevationState: 'ready' }
    renderSheet({ place: withElev, mode: 'round' })
    const t = tripEstimate(withElev, 'round', 16)
    const stats = document.querySelector('.stats') as HTMLElement
    expect(within(stats).getByText(t.km.toFixed(1))).toBeTruthy()
    expect(within(stats).getByText(String(t.minutes))).toBeTruthy()
  })

  it('D6: segment sits under the name and above the stats', () => {
    renderSheet()
    const body = document.querySelector('.sheet__body')!
    const order = [...body.children].map((el) => el.className.split(' ')[0])
    expect(order.indexOf('sheet__title')).toBeLessThan(order.indexOf('segment'))
    expect(order.indexOf('segment')).toBeLessThan(order.indexOf('stats'))
  })

  it('clicking the CTA records the departure; segment, ran and favourite call back', () => {
    const p = renderSheet()
    const a = screen.getByRole('link', { name: /Googleマップで出発/ })
    a.addEventListener('click', (e) => e.preventDefault())
    fireEvent.click(a)
    expect(p.onGo).toHaveBeenCalledWith(place, 'round', expect.objectContaining({ mode: 'round' }))
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

  it('C19: locks the background with position:fixed and restores it on close', () => {
    const r = renderSheet()
    expect(document.body.style.position).toBe('fixed')
    r.rerender({ place: null })
    expect(document.body.style.position).toBe('')
  })
})
