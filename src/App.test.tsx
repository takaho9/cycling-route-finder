import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { mockFetch } from './test/fetchMock'

describe('App (temporary UI)', () => {
  it('falls back to demo location + demo data when all network calls fail', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    // geolocation missing → demo location
    Object.defineProperty(globalThis.navigator, 'geolocation', { value: undefined, configurable: true })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '30分' }))
    expect(await screen.findByText(/デモデータ/)).toBeTruthy()
    expect(screen.getAllByRole('link', { name: '片道ナビ' }).length).toBeGreaterThan(10)
  })
})
