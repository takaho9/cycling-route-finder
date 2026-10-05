import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { summarizeElevation } from '../lib/elevation'
import { ElevationBadge, elevationAxis, ElevationProfile, MIN_ELEV_SPAN_M, MiniElevation, reliefM } from './Elevation'

describe('elevationAxis (D1: vertical range)', () => {
  it.each([
    // [profile, lo, hi]
    [[65, 70, 77], 40, 110], // 実レンジ 12m → 60m に広げて中央寄せ（41〜101）→ 10m 単位で外側へ
    [[10, 10, 10], 0, 60], // 平らでも 60m。0m 以上なら下端は 0 を割らない
    [[0, 100, 200], 0, 240], // 実レンジ 200m × 1.15 = 230m（-15〜215 → -20〜220）を 0m 起点に上へずらす
    [[-3, -1, 2], -40, 30], // 0m 未満を含むときは負の下端も可（-30.5〜29.5 → 外側に丸め）
  ])('%j → %i..%i m', (profile, lo, hi) => {
    expect(elevationAxis(profile)).toEqual({ lo, hi })
  })

  it('always spans at least 60m, contains the data, and ends on 10m', () => {
    for (const p of [[3, 5], [120, 121], [40, 95], [500, 760, 610], [0, 0.5]]) {
      const { lo, hi } = elevationAxis(p)
      expect(hi - lo).toBeGreaterThanOrEqual(MIN_ELEV_SPAN_M)
      expect(lo).toBeLessThanOrEqual(Math.min(...p))
      expect(hi).toBeGreaterThanOrEqual(Math.max(...p))
      expect(lo % 10).toBe(0)
      expect(hi % 10).toBe(0)
    }
  })

  it('a gentle 12m rise uses less than 1/4 of the height (does not look like a mountain)', () => {
    const { lo, hi } = elevationAxis([65, 77])
    expect((77 - 65) / (hi - lo)).toBeLessThan(0.25)
  })
})

describe('ElevationProfile (D1)', () => {
  const s = summarizeElevation([65, 68, 72, 77, 74, 70], 5, { estimated: false })

  it('axis labels are the axis ends; one guide line; "高低差 Xm" at the top right', () => {
    const { container } = render(<ElevationProfile summary={s} roundTrip={false} straight={false} />)
    const labels = [...container.querySelectorAll('.elev-profile__axis span')].map((e) => e.textContent)
    expect(labels).toEqual(['110m', '40m'])
    expect(container.querySelectorAll('.elev-profile__guide')).toHaveLength(1)
    expect(container.querySelector('.elev-profile__relief')?.textContent).toBe(`高低差 ${reliefM(s.profile)}m`)
    expect(reliefM(s.profile)).toBe(12)
    expect(screen.getByRole('img', { name: /高低差12m/ })).toBeTruthy()
  })

  it('round trip: the turn line is placed from the distance (half of the doubled width)', () => {
    const { container } = render(<ElevationProfile summary={s} roundTrip straight={false} />)
    const turn = container.querySelector('.elev-profile__turn')!
    expect(Number(turn.getAttribute('x1'))).toBeCloseTo(160, 6) // 320 × 5km / 10km
    expect(screen.getByText('📍 折り返し')).toBeTruthy()
  })

  it('round trip with a missing first sample still turns at the distance, not at the last point / 2', () => {
    const gappy = summarizeElevation([null, 68, 72, 77, 74, 70], 5, { estimated: false })
    const { container } = render(<ElevationProfile summary={gappy} roundTrip straight={false} />)
    expect(Number(container.querySelector('.elev-profile__turn')!.getAttribute('x1'))).toBeCloseTo(160, 6)
  })

  it('the mini graph uses the same 60m minimum (a flat route stays flat)', () => {
    const flat = summarizeElevation([20, 21, 22, 21, 20], 4)
    const { container } = render(<MiniElevation summary={flat} />)
    const ys = container
      .querySelector('polyline')!
      .getAttribute('points')!
      .split(' ')
      .map((p) => Number(p.split(',')[1]))
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(28 * 0.1)
  })
})

describe('ElevationBadge (D11)', () => {
  it('estimated values get "≈" instead of the word 推定', () => {
    const est = summarizeElevation([10, 30, 50], 4)
    const { container, rerender } = render(<ElevationBadge summary={est} state="ready" />)
    expect(container.textContent).toBe('≈+40mゆる')
    expect(container.textContent).not.toContain('推定')
    expect(screen.getByLabelText('高低差 約40m ゆる（推定）')).toBeTruthy()
    rerender(<ElevationBadge summary={{ ...est, estimated: false }} state="ready" />)
    expect(container.textContent).toBe('+40mゆる')
  })
})
