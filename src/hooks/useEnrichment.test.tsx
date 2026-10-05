import { act, render, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { demoServices, type Services } from '../lib/services'
import type { Place } from '../lib/types'
import { ENRICH_DEBOUNCE_MS, useEnrichment, useVisibility } from './useEnrichment'

const TOKYO = { lat: 35.6812, lng: 139.7671 }
const place = (id: string): Place => ({ id, name: id, lat: 35.7, lng: 139.8, category: 'park', distanceKm: 3, bearing: 0, source: 'overpass' })

describe('useEnrichment', () => {
  it('debounces place changes by 300ms before fetching (C21)', async () => {
    vi.useFakeTimers()
    const elevations = vi.fn(async () => new Map())
    const services: Services = { ...demoServices, demo: false, elevations, photos: vi.fn(async () => new Map()) }
    const { rerender } = renderHook(({ places }) => useEnrichment(services, TOKYO, places), { initialProps: { places: [place('a')] } })
    act(() => vi.advanceTimersByTime(100))
    rerender({ places: [place('b')] })
    act(() => vi.advanceTimersByTime(100))
    rerender({ places: [place('c')] })
    act(() => vi.advanceTimersByTime(ENRICH_DEBOUNCE_MS - 1))
    expect(elevations).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(1))
    expect(elevations).toHaveBeenCalledTimes(1)
    expect((elevations.mock.calls[0] as unknown as [unknown, Place[]])[1].map((p) => p.id)).toEqual(['c'])
  })
})

describe('useVisibility (C18)', () => {
  it('unobserves elements when they unmount and reports them as hidden', () => {
    const observe = vi.fn()
    const unobserve = vi.fn()
    class FakeIO {
      observe = observe
      unobserve = unobserve
      disconnect = vi.fn()
    }
    vi.stubGlobal('IntersectionObserver', FakeIO)
    const onChange = vi.fn()
    function Item({ id }: { id: string }) {
      const ref = useVisibility(onChange)
      return <div data-place-id={id} ref={ref} />
    }
    const { rerender } = render(
      <>
        <Item id="a" />
        <Item id="b" />
      </>,
    )
    expect(observe).toHaveBeenCalledTimes(2)
    rerender(<Item id="a" />)
    expect(unobserve).toHaveBeenCalledTimes(1)
    expect((unobserve.mock.calls[0][0] as HTMLElement).dataset.placeId).toBe('b')
    expect(onChange).toHaveBeenCalledWith('b', false)
  })
})
