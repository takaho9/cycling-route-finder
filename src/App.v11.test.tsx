import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { clearPlacesCache } from './lib/places'
import { demoServices, type Services } from './lib/services'
import { STORAGE_KEYS } from './lib/storage'
import { getUpdateReady, setUpdateReady } from './lib/swUpdate'
import { mockGeolocation } from './test/geo'

const NOW = new Date('2026-10-07T15:00:00+09:00')
const TOKYO = { lat: 35.6812, lng: 139.7671 }

beforeEach(() => {
  clearPlacesCache()
  setUpdateReady(null)
})

/** デモデータのまま、経路だけ OSRM で取れたことにする（経路距離 = 直線 × 1.45） */
const routedServices: Services = {
  ...demoServices,
  async routeDetail(origin, place) {
    const r = await demoServices.routeDetail(origin, place)
    return {
      route: { ...r.route, source: 'osrm', distanceKm: r.route.distanceKm * 1.45 },
      elevation: r.elevation && { ...r.elevation, estimated: false },
    }
  },
}

async function openResults() {
  fireEvent.click(screen.getByRole('button', { name: /候補を見る/ }))
  await screen.findByText('今日のおすすめ')
}

/** カードの「⏱ 40分 · 片道5.4km」の aria-label から数値を取る */
function cardTrip(card: HTMLElement) {
  const label = card.querySelector('.trip')!.getAttribute('aria-label')!
  const m = /走行目安 (\d+)分、片道 ([\d.]+)km/.exec(label)!
  return { minutes: Number(m[1]), oneWayKm: Number(m[2]) }
}
function detailStats() {
  const stats = document.querySelector('.stats') as HTMLElement
  const nums = [...stats.querySelectorAll('.stats__num')].map((n) => n.textContent ?? '')
  return { km: parseFloat(nums[0]), minutes: parseInt(nums[1], 10) }
}

describe('D2: card and detail show the same numbers', () => {
  it('estimate (before the route), then the route distance — card, detail and departure record agree', async () => {
    mockGeolocation(TOKYO)
    render(<App services={routedServices} now={() => NOW} />)
    await openResults()
    const recs = screen.getByRole('region', { name: '今日のおすすめ' })
    const card = within(recs).getAllByRole('article')[0]
    const before = cardTrip(card)
    expect(card.querySelector('.trip')!.textContent).toMatch(/⏱\d+分·片道[\d.]+km/)

    fireEvent.click(within(within(card).getByRole('heading')).getByRole('button'))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('経路で更新')).toBeTruthy()
    // 経路距離が反映されたあと: 詳細（往復）とカードが同じ値
    await waitFor(() => {
      const after = cardTrip(card)
      expect(after.oneWayKm).toBeGreaterThan(before.oneWayKm)
      const d = detailStats()
      expect(d.minutes).toBe(after.minutes)
      expect(d.km).toBeCloseTo(after.oneWayKm * 2, 1)
    })
    // 走行時間は 5 分単位（15 分以上）
    expect(cardTrip(card).minutes % 5).toBe(0)

    // 出発記録の予定分も同じ値
    const go = within(dialog).getByRole('link', { name: /Googleマップで出発/ })
    go.addEventListener('click', (e) => e.preventDefault())
    fireEvent.click(go)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.departure)!).plannedMin).toBe(cardTrip(card).minutes)
  })
})

describe('C4: "now" is re-evaluated when the app comes back', () => {
  it('the "行ってきた？" strip appears after time passes, without reloading', () => {
    mockGeolocation(TOKYO)
    localStorage.setItem(
      STORAGE_KEYS.departure,
      JSON.stringify({ placeId: 'p', name: '晴海ふ頭公園', category: 'seaside', at: NOW.toISOString(), plannedMin: 60 }),
    )
    let t = NOW
    render(<App services={demoServices} now={() => t} />)
    expect(screen.queryByText(/行ってきた？/)).toBeNull()
    t = new Date(NOW.getTime() + 50 * 60_000)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByRole('heading', { name: '晴海ふ頭公園、行ってきた？' })).toBeTruthy()
    // 12 時間を過ぎたら消える（期限切れ）
    t = new Date(NOW.getTime() + 13 * 3600_000)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(screen.queryByText(/行ってきた？/)).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.departure)).toBeNull()
  })
})

describe('C22: the back button closes overlays', () => {
  it('popstate closes the detail sheet but keeps the results screen', async () => {
    mockGeolocation(TOKYO)
    render(<App services={demoServices} now={() => NOW} />)
    await openResults()
    const recs = screen.getByRole('region', { name: '今日のおすすめ' })
    fireEvent.click(within(within(within(recs).getAllByRole('article')[0]).getByRole('heading')).getByRole('button'))
    await screen.findByRole('dialog')
    expect(history.state).toMatchObject({ screen: 'results', overlay: true })
    act(() => {
      history.replaceState({ screen: 'results' }, '')
      window.dispatchEvent(new PopStateEvent('popstate', { state: { screen: 'results' } }))
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('今日のおすすめ')).toBeTruthy()
  })

  it('popstate closes the settings sheet on home', () => {
    mockGeolocation(TOKYO)
    render(<App services={demoServices} now={() => NOW} />)
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    expect(screen.getByRole('dialog', { name: '設定' })).toBeTruthy()
    act(() => {
      history.replaceState(null, '')
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('D4/D8 and home', () => {
  it('no FAB while only the recommendations are shown; it appears with the full list', async () => {
    mockGeolocation(TOKYO)
    render(<App services={demoServices} now={() => NOW} />)
    await openResults()
    expect(screen.getAllByRole('button', { name: 'おまかせ（ガチャ）' })).toHaveLength(1) // ヘッダーの 🎲 だけ
    expect(document.querySelector('.fab')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /もっと見る/ }))
    expect(document.querySelector('.fab')).not.toBeNull()
  })

  it('shows "この範囲に N か所（デモ）" once the search is done', async () => {
    mockGeolocation(TOKYO)
    render(<App services={demoServices} now={() => NOW} />)
    const count = await screen.findByText(/この範囲に/)
    expect(count.textContent).toMatch(/^この範囲に\d+か所（デモ）$/)
  })
})

describe('C16: service worker update is a prompt', () => {
  it('applies immediately on the idle home screen', () => {
    mockGeolocation(TOKYO)
    let applied = 0
    render(<App services={demoServices} now={() => NOW} />)
    act(() => setUpdateReady(() => applied++))
    expect(applied).toBe(1)
  })

  it('on the results screen shows a "新しいバージョンがあります" toast with an update button', async () => {
    mockGeolocation(TOKYO)
    let applied = 0
    render(<App services={demoServices} now={() => NOW} />)
    await openResults()
    act(() => setUpdateReady(() => applied++))
    expect(applied).toBe(0)
    expect(screen.getByText('新しいバージョンがあります')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '更新する' }))
    expect(applied).toBe(1)
    expect(getUpdateReady()).not.toBeNull()
  })
})
