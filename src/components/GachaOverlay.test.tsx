import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { tripEstimate } from '../lib/trip'
import { GACHA_REVEAL_MS, GachaOverlay } from './GachaOverlay'
import type { ViewPlace } from './types'

const vp = (id: string, name: string, visited = false): ViewPlace => ({
  id,
  name,
  lat: 35.7,
  lng: 139.7,
  category: 'cafe',
  distanceKm: 3,
  bearing: 0,
  source: 'mock',
  elevationState: 'none',
  visited,
  favorite: false,
})
const pool = [vp('a', 'カフェA'), vp('b', 'カフェB', true), vp('c', 'カフェC')]
const base = {
  pool,
  tripOf: (p: ViewPlace) => tripEstimate(p, 'round', 16),
  goHrefOf: (p: ViewPlace) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`,
  canDepart: true,
  onGo: vi.fn(),
  onDecide: vi.fn(),
  onClose: vi.fn(),
  rng: () => 0,
}

describe('GachaOverlay', () => {
  it('spins with "N件の中から…", then reveals a NEW result; the main button departs straight to Maps (D3)', () => {
    vi.useFakeTimers()
    const onGo = vi.fn()
    const onDecide = vi.fn()
    render(<GachaOverlay {...base} reduced={false} onGo={onGo} onDecide={onDecide} />)
    expect(screen.getByText('どこにしよう…')).toBeTruthy()
    expect(screen.getByText(/件の中から…/).textContent).toBe('3件の中から…')
    expect(screen.queryByText('今日はここ！')).toBeNull()
    act(() => vi.advanceTimersByTime(GACHA_REVEAL_MS))
    expect(screen.getByRole('heading', { name: '今日はここ！' })).toBeTruthy()
    expect(screen.getByText('カフェA')).toBeTruthy()
    expect(screen.getByText('NEW')).toBeTruthy()
    const go = screen.getByRole('link', { name: /ここに決めて出発/ }) as HTMLAnchorElement
    expect(go.href).toContain('google.com/maps/dir')
    expect(go.target).toBe('_blank')
    go.addEventListener('click', (e) => e.preventDefault())
    fireEvent.click(go)
    expect(onGo).toHaveBeenCalledWith(pool[0])
    fireEvent.click(screen.getByRole('button', { name: 'くわしく見る' }))
    expect(onDecide).toHaveBeenCalledWith(pool[0])
  })

  it('reduced motion skips the capsule; "もう1回" never repeats the previous result; "やめとく" closes', () => {
    const onClose = vi.fn()
    render(<GachaOverlay {...base} reduced onClose={onClose} />)
    expect(screen.queryByText('どこにしよう…')).toBeNull()
    expect(screen.getByText('カフェA')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /もう1回/ }))
    expect(screen.queryByText('カフェA')).toBeNull()
    expect(screen.getByText('カフェB')).toBeTruthy()
    expect(screen.queryByText('NEW')).toBeNull() // 行ったことある場所
    fireEvent.click(screen.getByRole('button', { name: 'やめとく' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('fallen back to demo (C6): no direct departure, "くわしく見る" is the main action', () => {
    const onDecide = vi.fn()
    render(<GachaOverlay {...base} reduced canDepart={false} onDecide={onDecide} />)
    expect(screen.queryByRole('link', { name: /出発/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /くわしく見る/ }))
    expect(onDecide).toHaveBeenCalledWith(pool[0])
  })
})
