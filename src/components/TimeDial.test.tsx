import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { angleToIndex, formatDial, TimeDial } from './TimeDial'

/** viewBox 340×196 を 340×196px で描いた想定（中心 170,178・半径 142） */
function layout(svg: Element) {
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 340, height: 196, right: 340, bottom: 196, x: 0, y: 0, toJSON: () => ({}) })
}
const at = (deg: number, r = 142) => ({ clientX: 170 + r * Math.cos((deg * Math.PI) / 180), clientY: 178 - r * Math.sin((deg * Math.PI) / 180) })

describe('TimeDial', () => {
  it('is an accessible slider (0..5, valuetext)', () => {
    render(<TimeDial index={2} onChange={() => {}} valueText="45分、片道約6.0km" />)
    const s = screen.getByRole('slider', { name: '往復の時間' })
    expect(s.getAttribute('aria-valuemin')).toBe('0')
    expect(s.getAttribute('aria-valuemax')).toBe('5')
    expect(s.getAttribute('aria-valuenow')).toBe('2')
    expect(s.getAttribute('aria-valuetext')).toBe('45分、片道約6.0km')
    expect(s.textContent).toContain('45')
  })

  it('arrow / Home / End keys move one step and clamp at the ends', () => {
    const onChange = vi.fn()
    const { rerender } = render(<TimeDial index={2} onChange={onChange} valueText="" />)
    const s = screen.getByRole('slider')
    fireEvent.keyDown(s, { key: 'ArrowRight' })
    fireEvent.keyDown(s, { key: 'ArrowLeft' })
    fireEvent.keyDown(s, { key: 'End' })
    fireEvent.keyDown(s, { key: 'Home' })
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([3, 1, 5, 0])
    onChange.mockClear()
    rerender(<TimeDial index={5} onChange={onChange} valueText="" />)
    fireEvent.keyDown(s, { key: 'ArrowRight' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('pointer drag snaps to the nearest tick (left = 15 min → right = 1h30)', () => {
    const onChange = vi.fn()
    const { container } = render(<TimeDial index={2} onChange={onChange} valueText="" />)
    const svg = container.querySelector('svg')!
    layout(svg)
    fireEvent.pointerDown(svg, { ...at(170), pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(0)
    fireEvent.pointerMove(svg, { ...at(70), pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(3) // 70° は 1 時間（75°）の目盛りが最寄り
    fireEvent.pointerMove(svg, { ...at(10), pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(5)
    fireEvent.pointerUp(svg, { pointerId: 1 })
    onChange.mockClear()
    fireEvent.pointerMove(svg, { ...at(160), pointerId: 1 }) // ドラッグ終了後は反応しない
    expect(onChange).not.toHaveBeenCalled()
  })

  it('angleToIndex / formatDial', () => {
    expect([180, 165, 150, 136, 119, 90, 15, 0, -30, 200].map(angleToIndex)).toEqual([0, 0, 1, 1, 2, 3, 5, 5, 5, 0])
    expect(formatDial(45)).toEqual({ value: '45', unit: '分' })
    expect(formatDial(75)).toEqual({ value: '1:15', unit: '時間' })
  })
})
