import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FilterBar } from './FilterBar'

describe('FilterBar', () => {
  const setup = () => {
    const props = {
      elevation: 'all' as const,
      onElevation: vi.fn(),
      categories: new Set(['cafe' as const]),
      available: ['park', 'cafe', 'shrine'] as const,
      onToggleCategory: vi.fn(),
      sort: 'near' as const,
      onSort: vi.fn(),
    }
    render(<FilterBar {...props} available={[...props.available]} />)
    return props
  }

  it('elevation chips are a single-select radio group with shape icons', () => {
    const p = setup()
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual(['全部', '平坦', 'ゆる', 'ヒル'])
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
    expect(radios[3].querySelector('svg')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'ヒル' }))
    expect(p.onElevation).toHaveBeenCalledWith('hilly')
  })

  it('category chips: only available categories, in display order, multi-select toggles with aria-pressed', () => {
    const p = setup()
    const chips = screen.getAllByRole('button')
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual(['カフェ', '神社・お寺', '公園・緑地'])
    expect(screen.getByRole('button', { name: 'カフェ' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '公園・緑地' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: '公園・緑地' }))
    expect(p.onToggleCategory).toHaveBeenCalledWith('park')
  })

  it('sort select offers the five orders', () => {
    const p = setup()
    const select = screen.getByRole('combobox', { name: '並び替え' }) as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['近い順', '遠い順', '平坦順', 'ランダム', '行ったことない順'])
    fireEvent.change(select, { target: { value: 'unvisited' } })
    expect(p.onSort).toHaveBeenCalledWith('unvisited')
  })
})
