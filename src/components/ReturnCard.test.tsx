import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReturnCard } from './ReturnCard'

describe('ReturnCard', () => {
  it('asks about the last departure and answers yes / no', () => {
    const onYes = vi.fn()
    const onNo = vi.fn()
    render(
      <ReturnCard
        departure={{ placeId: 'p', name: '湯島天満宮', category: 'shrine', at: '2026-10-07T05:00:00Z', plannedMin: 45 }}
        onYes={onYes}
        onNo={onNo}
      />,
    )
    const region = screen.getByRole('region', { name: '湯島天満宮、行ってきた？' })
    expect(region.textContent).toContain('⛩️')
    fireEvent.click(screen.getByRole('button', { name: '✓ 走った' }))
    fireEvent.click(screen.getByRole('button', { name: '✕ 行かなかった' }))
    expect(onYes).toHaveBeenCalledTimes(1)
    expect(onNo).toHaveBeenCalledTimes(1)
  })

  it('falls back to a pin when the category is unknown', () => {
    render(<ReturnCard departure={{ placeId: 'p', name: 'どこか', at: '2026-10-07T05:00:00Z', plannedMin: 30 }} onYes={() => {}} onNo={() => {}} />)
    expect(screen.getByRole('region').textContent).toContain('📍')
  })
})
