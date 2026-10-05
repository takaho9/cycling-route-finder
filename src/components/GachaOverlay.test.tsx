import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GACHA_REVEAL_MS, GachaOverlay } from './GachaOverlay'
import type { ViewPlace } from './types'

const vp = (id: string, name: string): ViewPlace => ({
  id,
  name,
  lat: 35.7,
  lng: 139.7,
  category: 'cafe',
  distanceKm: 3,
  bearing: 0,
  source: 'mock',
  elevationState: 'none',
  visited: false,
  favorite: false,
})
const pool = [vp('a', 'カフェA'), vp('b', 'カフェB'), vp('c', 'カフェC')]
const metricsOf = () => ({ km: 4, min: 30 })

describe('GachaOverlay', () => {
  it('spins, then reveals a result; decide opens it', () => {
    vi.useFakeTimers()
    const onDecide = vi.fn()
    render(<GachaOverlay pool={pool} metricsOf={metricsOf} reduced={false} onDecide={onDecide} onClose={() => {}} rng={() => 0} />)
    expect(screen.getByText('どこにしよう…')).toBeTruthy()
    expect(screen.queryByText('今日はここ！')).toBeNull()
    act(() => vi.advanceTimersByTime(GACHA_REVEAL_MS))
    expect(screen.getByRole('heading', { name: '今日はここ！' })).toBeTruthy()
    expect(screen.getByText('カフェA')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ここに決めた！' }))
    expect(onDecide).toHaveBeenCalledWith(pool[0])
  })

  it('reduced motion skips the capsule; "もう1回" never repeats the previous result; "やめとく" closes', () => {
    const onClose = vi.fn()
    render(<GachaOverlay pool={pool} metricsOf={metricsOf} reduced onDecide={() => {}} onClose={onClose} rng={() => 0} />)
    expect(screen.queryByText('どこにしよう…')).toBeNull()
    expect(screen.getByText('カフェA')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /もう1回/ }))
    expect(screen.queryByText('カフェA')).toBeNull()
    expect(screen.getByText('カフェB')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'やめとく' }))
    expect(onClose).toHaveBeenCalled()
  })
})
