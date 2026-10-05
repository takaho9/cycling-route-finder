import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { StaticIndex } from '../lib/places/staticData'
import { formatGeneratedAt, SettingsSheet } from './SettingsSheet'

const INFO: StaticIndex = {
  v: 1,
  version: 'x',
  generatedAt: '2026-10-05T19:30:00.000Z',
  sample: true,
  region: '東京都（島しょ部を除く）',
  grid: 0.05,
  count: 1234,
  bytes: 1,
  tiles: {},
  coverage: { bbox: [0, 0, 1, 1] },
  sources: [
    { name: '© OpenStreetMap contributors', license: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright' },
    { name: 'Wikidata', license: 'CC0 1.0', url: 'https://www.wikidata.org/' },
  ],
}

const props = {
  onClose: () => {},
  speed: 'normal' as const,
  onSpeed: () => {},
  weeklyGoal: 3,
  onWeeklyGoal: () => {},
  origin: null,
  onChangeOrigin: () => {},
}

describe('SettingsSheet data credits (v1.3)', () => {
  it('shows the generation time (JST), count, sample flag and sources of the pre-built data', async () => {
    const load = vi.fn(async () => INFO)
    render(<SettingsSheet open {...props} loadDataInfo={load} />)
    await waitFor(() => expect(screen.getByText(/の行き先データ/)).toBeTruthy())
    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.getByText('（サンプル）')).toBeTruthy()
    expect(screen.getByText(formatGeneratedAt(INFO.generatedAt))).toBeTruthy()
    expect(formatGeneratedAt(INFO.generatedAt)).toBe("2026/10/6 04:30")
    expect(screen.getByText('1,234')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Wikidata' }).getAttribute('href')).toBe('https://www.wikidata.org/')
  })

  it('shows nothing extra when the data info is unavailable', async () => {
    render(<SettingsSheet open {...props} loadDataInfo={async () => null} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(/の行き先データ/)).toBeNull()
  })
})
